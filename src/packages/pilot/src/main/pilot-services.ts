import { defaultUsagePaths, measureFinishedSteps, stepUsageReader } from './usage/step-usage'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../../../../main/runtime/rpc/methods/index'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import { answerRunEnded } from './answers/answer-run-end'
import { wireAnswerDispatcher } from './answers/wiring'
import { pilotActionCatalog } from './actions/wiring'
import { definitionIo, liveDefinitions } from './definitions/live'
import { createEnvService } from './envs/service'
import { handoverService } from './handover/service'
import { buildInboxDeps } from './inbox/inbox-service'
import type { LoadedDefinitions } from './definitions/loader'
import { mergeRepoProblems, type RepoProblem } from './definitions/repo-problems'
import {
  pilotAutomationDirs,
  pilotDataDir,
  pilotDetailsRoot,
  pilotVaultAutomationsDir
} from './env'
import { resolveEngineEnv } from './engine-env'
import { runtimeActivity } from './fields/activity-facts'
import { cachedQuotas } from './fields/quota'
import { reposListed, resolveRepoPath } from './fields/runtime-facts'
import { runtimeFieldDeps } from './fields/runtime-field-deps'
import { runShellScript } from './fields/script-runner'
import { launchAgentStep } from './run/agent-step'
import { wireRunEngine } from './run/engine-wiring'
import { pilotShellWiring } from './run/shell-wiring'
import { cancelUnstartedRun, runAnswerSources } from './run/ask-first'
import { runtimeLauncherDeps } from './run/launch'
import { resumeStepSession, runtimeResumeDeps } from './run/resume-session'
import { modeTextFor, readMode } from './run/modes'
import { sweepStaleStarts } from './run/stale-starts'
import { terminalRelister } from './run/terminal-relist'
import { agentStepStarter } from './run/step-starters'
import { runtimeStepProbe } from './run/watcher'
import { openPlayground } from './playground/create'
import { buildPilotMethods } from './rpc/methods'
import { registerPilotRpcMethods } from './rpc/register'
import { PilotScheduler } from './scheduler/scheduler'
import { registrySources } from './scheduler/tick-decide'
import { runTick, type TickDeps } from './scheduler/tick-runner'
import { createPassFetchCache } from './sources/fetch-cache'
import { glabApiForRepo } from './sources/gitlab-api'
import { registerPilotSources } from './sources/register-sources'
import { PilotStore } from './store/store'
import { VaultExporter } from './vault/export'
import { housekeepStore } from './store/housekeep'
import { usageReporter } from './usage-report/reporter'
import { closeAll, softly } from './pilot-lifecycle'
import { wireRunCapacity } from './capacity/capacity-wiring'
import type { PilotContext, PilotHost, PilotServiceOptions, PilotServices } from './pilot-context'

export type { PilotContext, PilotHost, PilotServiceOptions, PilotServices } from './pilot-context'

const log = (message: string): void => console.log(message)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Each thing opened is pushed on `opened`, so a failure part way closes exactly what is open.
function openPilot(
  runtime: OrcaRuntimeService,
  host: PilotHost,
  options: PilotServiceOptions,
  opened: (() => void)[]
): PilotContext {
  const now = Date.now
  const schedulerOn = options.schedulerEnabled ?? false
  const detailsRoot = pilotDetailsRoot()
  mkdirSync(host.dataDir, { recursive: true })
  const store = PilotStore.open(join(host.dataDir, 'pilot-automations.db'))
  opened.push(() => store.close())
  // Before the definitions load: a where clause of these kinds validates against their schemas.
  registerPilotSources({ runtime, store })
  housekeepStore(store, now, log)
  const definitions = liveDefinitions(host.dirs, log, definitionIo(store.definitions, now))
  opened.push(definitions.stop)
  // One relister for the session check and the step watcher, so they share its listing.
  const relist = terminalRelister(runtime, now)
  const quotas = cachedQuotas(options.quotas)
  // How field scripts and script checks reach Pilot's CLI and data folder (H9); orcad gets the default.
  const engineEnv = resolveEngineEnv(options.engineEnv, host.dataDir)
  const fieldDeps = runtimeFieldDeps(runtime, store, { relist, now })
  // `store.runs`: a new worktree's claim reads and records running runs there (Task 8b).
  const launcherDeps = {
    ...runtimeLauncherDeps(runtime, fieldDeps, now, store.runs),
    modeText: modeTextFor(readMode)
  }
  const definitionFor = (id: string) =>
    definitions.current().definitions.find((d) => d.id === id) ?? null
  const { capacity, memory } = wireRunCapacity({
    runtime,
    store,
    now,
    definitions: () => definitions.current().definitions
  })
  // Job environments (pilotcli env): prepared off the tick, removed when runs end (main/envs).
  const envs = createEnvService({
    runtime,
    store,
    now,
    log,
    definitionFor,
    engineEnv,
    dataDir: host.dataDir,
    terminalDraft: (h) => fieldDeps.terminalDraft(h),
    // The rest of a run's end, before its env is removed: an answer run's outputs reach its cards (G6).
    onRunEnd: (run) => answerRunEnded(store, run)
  })
  opened.push(() => envs.stop())
  // A stage's run end hands over to the next stage; its run: now reaches the scheduler once made (below).
  const handover = handoverService({ store, now, definitionFor, log })
  // The one run engine of this process: its per-run lock and its set of runs being opened live in it.
  const wired = wireRunEngine({
    runtime,
    store,
    now,
    definitionFor,
    startAgentStep: agentStepStarter((req) => launchAgentStep(store, req, launcherDeps)),
    workspace: launcherDeps.workspace,
    engineEnv,
    shell: pilotShellWiring(),
    envs: envs.preparations,
    probe: runtimeStepProbe(runtime, relist),
    log,
    // An answer run's outputs reach its cards (G6), then the run's env is removed (envs.runEnded, above).
    onRunEnd: (run) => envs.runEnded(run),
    // A stage's run hands its outputs to the next stage (job.feeds).
    handover: handover.runEnd,
    // {run.answer}: the free text that started an ask-first or answer run; {run.choice}: the option that started it.
    ...runAnswerSources(store)
  })
  const actions = pilotActionCatalog({
    engineEnv,
    runtime,
    startRun: {
      store,
      now,
      definitions: () => definitions.current().definitions,
      start: (req) => wired.engine.startRun(req),
      schedulerOn: () => schedulerOn,
      displayOnly: () => definitions.current().displayOnly ?? [],
      hasFreeSlot: (def) => capacity.hasFreeSlot(def)
    }
  })
  // The tick's asks and the answers pass share it: a card closed without starting its run (Skip, stale,
  // obsolete) cancels that run.
  const inbox = buildInboxDeps({
    store,
    now,
    definitions: () => definitions.current().definitions,
    people: () => definitions.current().people,
    actions,
    onResolved: (item) => cancelUnstartedRun(store, item, now()),
    detailsRoot
  })
  const tickDeps: TickDeps = {
    store,
    now,
    resolveRepo: (repo) => resolveRepoPath(runtime, repo),
    sources: registrySources,
    fields: {
      ...fieldDeps,
      quotas,
      pendingAnswers: (automationId, itemKey) =>
        store.queue.pendingAnswerCount(automationId, itemKey),
      cache: store.fields,
      runScript: runShellScript,
      engineEnv,
      now
    },
    activity: runtimeActivity(runtime, fieldDeps.terminalAlive),
    launch: (req) => wired.engine.startRun(req),
    ask: { store, now, inbox },
    previewEnvs: (def, decisions) => envs.preview(def, decisions),
    capacity
  }
  const repoProblems = new Map<string, RepoProblem>()
  const withRepoProblems = (loaded: LoadedDefinitions): LoadedDefinitions =>
    mergeRepoProblems(loaded, repoProblems, (repo) => reposListed(runtime, [repo]))
  const vaultDir = pilotVaultAutomationsDir()
  const exporter = vaultDir
    ? new VaultExporter({
        store,
        now,
        dir: vaultDir,
        definitions: () => definitions.current().definitions,
        log
      })
    : null
  // Only the process that runs the scheduler applies answers, like the vault export.
  const dispatcher = schedulerOn
    ? wireAnswerDispatcher({
        runtime,
        store,
        now,
        definitions: () => definitions.current().definitions,
        inbox,
        actions,
        quotas,
        facts: fieldDeps,
        envs: envs.answerHooks,
        capacity,
        log
      })
    : null
  const readUsage = stepUsageReader(defaultUsagePaths(), now)
  const usageReports = usageReporter(store, definitions, now, log, options.resourcesDir)
  const scheduler = new PilotScheduler({
    now,
    definitions: definitions.current,
    runTick: (def, opts) => runTick(def, definitions.current().people, tickDeps, opts),
    lastTickAt: (id) => store.lastTick(id)?.startedAt ?? null,
    poll: async () => {
      await wired.poll()
      await softly('memory', () => memory.sample(), log)
      await softly('usage', () => measureFinishedSteps(store, readUsage, now, log), log)
      await softly('usage report', () => usageReports.refreshIfDue(), log)
      await softly('answers', () => dispatcher?.pass(), log)
      await softly('vault export', () => exporter?.pass(), log)
      await softly('handovers', () => handover.housekeep(), log)
      await softly('envs', () => envs.housekeep(), log)
    },
    reposListed: (repos) => reposListed(runtime, repos),
    repoProblem: (def, message) =>
      repoProblems.set(def.id, { file: def.file, repo: def.repo, message }),
    newPass: () => createPassFetchCache(`pass-${now()}`, glabApiForRepo),
    queuedToTick: (defs) => capacity.toTick(defs),
    log
  })
  handover.deps.trigger = (id, cause) => scheduler.trigger(id, cause)
  opened.push(() => scheduler.stop())
  const playground = openPlayground(runtime, engineEnv.binDir, opened)
  // The attach hooks decide (pilotSchedulerEnabled); a caller that doesn't say gets no scheduler.
  if (schedulerOn) {
    void softly('envs at start', () => envs.startup(), log)
    sweepStaleStarts(store, now, log)
    scheduler.start()
  } else {
    log(`[pilot] scheduler off in ${host.processKind} (PILOT_SCHEDULER=on runs it here)`)
  }
  return {
    processKind: host.processKind,
    store,
    dirs: host.dirs,
    loaded: () => withRepoProblems(definitions.current()),
    reload: () => withRepoProblems(definitions.reload()),
    scheduler,
    actions,
    dispatcher,
    schedulerOn,
    engineEnv,
    detailsRoot,
    playground,
    memory,
    writeUsageReport: (dir) => usageReports.write(dir),
    resumeSession: (req) => resumeStepSession(runtimeResumeDeps(runtime, store, fieldDeps), req)
  }
}

// Shared by desktop/serve and orcad. Production time is Date.now; everything below takes it injected.
// Throws if Pilot can't start, after closing whatever it opened; the attach hooks catch it so Orca
// itself keeps starting.
export function startPilotServices(
  runtime: OrcaRuntimeService,
  processKind: PilotStatus['process'],
  options: PilotServiceOptions = {}
): PilotServices {
  const host: PilotHost = {
    processKind,
    dirs: pilotAutomationDirs(),
    dataDir: pilotDataDir(processKind, getAppEnvironment().getPath('userData')),
    context: null,
    error: null
  }
  registerPilotRpcMethods(ALL_RPC_METHODS as unknown[], buildPilotMethods(host))
  const opened: (() => void)[] = []
  let context: PilotContext
  try {
    context = openPilot(runtime, host, options, opened)
  } catch (error) {
    host.error = messageOf(error)
    closeAll(opened, log)
    throw error
  }
  host.context = context
  const count = context.loaded().definitions.length
  log(`[pilot] attached (${processKind}): ${count} automation(s) from ${host.dirs.join(', ')}`)
  let stopped = false
  return {
    context,
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      closeAll(opened, log)
      log(`[pilot] stopped (${processKind})`)
    }
  }
}
