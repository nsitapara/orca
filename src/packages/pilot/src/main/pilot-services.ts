import { defaultUsagePaths, measureFinishedSteps, stepUsageReader } from './usage/step-usage'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../../../../main/runtime/rpc/methods/index'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import type { AgentKind } from '../shared/definition/types'
import { actBridge } from './actions/act-bridge'
import { answerRunEnded } from './answers/answer-run-end'
import type { AnswerDispatcher } from './answers/dispatcher'
import { wireAnswerDispatcher } from './answers/wiring'
import { startRunEntry } from './actions/start-run-entry'
import { buildActionCatalog } from './actions/catalog'
import type { ActionCatalog } from './actions/types'
import { definitionIo, liveDefinitions } from './definitions/live'
import type { LoadedDefinitions } from './definitions/loader'
import { mergeRepoProblems, type RepoProblem } from './definitions/repo-problems'
import { pilotAutomationDirs, pilotDataDir, pilotVaultAutomationsDir } from './env'
import { resolveEngineEnv, type EngineEnv } from './engine-env'
import { runtimeActivity } from './fields/activity-facts'
import { cachedQuotas, type QuotaReader } from './fields/quota'
import { reposListed, resolveRepoPath } from './fields/runtime-facts'
import { runtimeFieldDeps } from './fields/runtime-field-deps'
import { runShellScript } from './fields/script-runner'
import { launchAgentStep } from './run/agent-step'
import { wireRunEngine } from './run/engine-wiring'
import { pilotStepEnv } from './run/step-launch-plan'
import { cancelUnstartedRun, runAnswerOf } from './run/ask-first'
import { runtimeLauncherDeps } from './run/launch'
import { modeTextFor, readMode } from './run/modes'
import { sweepStaleStarts } from './run/stale-starts'
import { terminalRelister } from './run/terminal-relist'
import { agentStepStarter } from './run/step-starters'
import { runtimeStepProbe } from './run/watcher'
import { buildPilotMethods } from './rpc/methods'
import { registerPilotRpcMethods } from './rpc/register'
import { PilotScheduler } from './scheduler/scheduler'
import { registrySources } from './scheduler/tick-decide'
import { runTick, type TickDeps } from './scheduler/tick-runner'
import { createPassFetchCache } from './sources/fetch-cache'
import { createLinearWriter } from './linear-connector/linear-writer'
import { glabApiForRepo } from './sources/gitlab-api'
import { registerPilotSources } from './sources/register-sources'
import { PilotStore } from './store/store'
import { writerGone } from './store/store-actions'
import { VaultExporter } from './vault/export'

export type PilotContext = {
  processKind: PilotStatus['process']
  store: PilotStore
  dirs: string[]
  loaded(): LoadedDefinitions
  reload(): LoadedDefinitions
  scheduler: PilotScheduler
  // Every outside effect goes through it (contract §10).
  actions: ActionCatalog
  // Saved answers' dispatcher (Task 24c); null in a process that doesn't run the scheduler.
  dispatcher: AnswerDispatcher | null
}
export type PilotServices = { stop: () => void; context: PilotContext }
// What pilot.status reads. It is registered before anything opens, so status still answers (with
// `error`) when Pilot couldn't start.
export type PilotHost = {
  processKind: PilotStatus['process']
  dirs: string[]
  dataDir: string
  context: PilotContext | null
  error: string | null
}
export type PilotServiceOptions = {
  quotas?: Partial<Record<AgentKind, QuotaReader>>
  // Where the engine's child processes find Pilot's CLI and data (H9). Absent in orcad.
  engineEnv?: EngineEnv
  schedulerEnabled?: boolean
}

const log = (message: string): void => console.log(message)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// One failing part of a scheduler pass (answers, the vault export) never stops the others (R13).
export async function softly(
  what: string,
  work: () => unknown,
  log: (message: string) => void
): Promise<void> {
  try {
    await work()
  } catch (error) {
    log(`[pilot] ${what} failed: ${messageOf(error)}`)
  }
}

// Newest first: the scheduler stops before the watcher, and both before the store closes.
function closeAll(opened: (() => void)[]): void {
  while (opened.length > 0) {
    const close = opened.pop()!
    try {
      close()
    } catch (error) {
      log(`[pilot] couldn't close cleanly: ${messageOf(error)}`)
    }
  }
}

// Each thing opened is pushed on `opened`, so a failure part way closes exactly what is open.
function openPilot(
  runtime: OrcaRuntimeService,
  host: PilotHost,
  options: PilotServiceOptions,
  opened: (() => void)[]
): PilotContext {
  const now = Date.now
  mkdirSync(host.dataDir, { recursive: true })
  const store = PilotStore.open(join(host.dataDir, 'pilot-automations.db'))
  opened.push(() => store.close())
  // Before the definitions load: a where clause of these kinds validates against their schemas.
  registerPilotSources({ runtime, store })
  const kept = store.housekeep(now())
  // Any process may run actions, and main and orcad may share a store: only a gone writer's are closed.
  const interrupted = store.actions.interruptRunning(now(), now(), writerGone)
  if (interrupted > 0) {
    log(`[pilot] store: ${interrupted} action(s) a stopped process left running marked failed`)
  }
  if (kept.interrupted > 0 || kept.pruned > 0) {
    log(
      `[pilot] store: ${kept.interrupted} interrupted tick(s) closed, ${kept.pruned} tick(s) older than 30 days removed`
    )
  }
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
  // The one run engine of this process: its per-run lock and its set of runs being opened live in it.
  const wired = wireRunEngine({
    runtime,
    store,
    now,
    definitionFor: (id) => definitions.current().definitions.find((d) => d.id === id) ?? null,
    startAgentStep: agentStepStarter((req) => launchAgentStep(store, req, launcherDeps)),
    workspace: launcherDeps.workspace,
    engineEnv,
    shell: {
      workspaceOf: async (req) => {
        if (!req.run.worktreePath) {
          throw new Error(`Run ${req.run.id} has no workspace`)
        }
        return { path: req.run.worktreePath }
      },
      envOf: (req) =>
        pilotStepEnv({
          runId: req.run.id,
          stepName: req.definition.steps[req.idx].name,
          stepIdx: req.idx,
          automationId: req.run.automationId,
          itemKey: req.run.itemKey,
          powers: req.definition.powers
        })
    },
    probe: runtimeStepProbe(runtime, relist),
    log,
    // An answer run's outputs reach the cards it was sent for (G6).
    onRunEnd: (run) => answerRunEnded(store, run),
    // {run.answer}: the free text that started an ask-first or answer run.
    runAnswer: (run) => runAnswerOf(store, run)
  })
  // Built once; nothing runs until an action is attempted. start_run reaches the engine lazily.
  const actions = buildActionCatalog({
    act: actBridge(),
    linear: createLinearWriter(runtime),
    extra: [
      startRunEntry({
        store,
        now,
        definitions: () => definitions.current().definitions,
        start: (req) => wired.engine.startRun(req)
      })
    ]
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
    // A card closed without starting its run (Skip, stale, obsolete) cancels that run.
    ask: {
      store,
      now,
      inbox: {
        store,
        now,
        definitions: () => definitions.current().definitions,
        people: () => definitions.current().people,
        knownAction: (name) => actions.get(name) !== null,
        actionArgsProblem: (name, args) => actions.get(name)?.checkArgs(args) ?? null,
        onResolved: (item) => cancelUnstartedRun(store, item, now())
      }
    }
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
  const dispatcher =
    (options.schedulerEnabled ?? false)
      ? wireAnswerDispatcher({
          runtime,
          store,
          now,
          definitions: () => definitions.current().definitions,
          people: () => definitions.current().people,
          actions,
          quotas,
          facts: fieldDeps,
          log
        })
      : null
  const readUsage = stepUsageReader(defaultUsagePaths(), now)
  const scheduler = new PilotScheduler({
    now,
    definitions: definitions.current,
    runTick: (def, opts) => runTick(def, definitions.current().people, tickDeps, opts),
    lastTickAt: (id) => store.lastRealTick(id)?.startedAt ?? null,
    poll: async () => {
      await wired.poll()
      await softly('usage', () => measureFinishedSteps(store, readUsage, now, log), log)
      await softly('answers', () => dispatcher?.pass(), log)
      await softly('vault export', () => exporter?.pass(), log)
    },
    reposListed: (repos) => reposListed(runtime, repos),
    repoProblem: (def, message) =>
      repoProblems.set(def.id, { file: def.file, repo: def.repo, message }),
    newPass: () => createPassFetchCache(`pass-${now()}`, glabApiForRepo),
    log
  })
  opened.push(() => scheduler.stop())
  // The attach hooks decide (pilotSchedulerEnabled); a caller that doesn't say gets no scheduler.
  if (options.schedulerEnabled ?? false) {
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
    dispatcher
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
    closeAll(opened)
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
      closeAll(opened)
      log(`[pilot] stopped (${processKind})`)
    }
  }
}
