import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../../../../main/runtime/rpc/methods/index'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import { liveDefinitions } from './definitions/live'
import type { LoadedDefinitions } from './definitions/loader'
import { pilotAutomationDirs, pilotDataDir } from './env'
import { cachedQuota, type QuotaReader } from './fields/quota'
import { resolveRepoPath, runtimeFactDeps } from './fields/runtime-facts'
import { claudeTranscriptCost } from './run/cost'
import { makeLauncher } from './run/launch'
import { sweepStaleStarts } from './run/stale-starts'
import { pollRunningSteps, runtimeStepProbe } from './run/watcher'
import { buildPilotMethods } from './rpc/methods'
import { registerPilotRpcMethods } from './rpc/register'
import { PilotScheduler } from './scheduler/scheduler'
import { runTick, type TickDeps } from './scheduler/tick-runner'
import { glabApiForRepo } from './sources/gitlab-api'
import { PilotStore } from './store/store'

export type PilotContext = {
  processKind: PilotStatus['process']
  store: PilotStore
  dirs: string[]
  loaded(): LoadedDefinitions
  reload(): LoadedDefinitions
  scheduler: PilotScheduler
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
export type PilotServiceOptions = { quota?: QuotaReader; schedulerEnabled?: boolean }

// orcad has no Claude quota reader (R3): the quota check then sees nulls and lets runs start.
const NO_QUOTA: QuotaReader = async () => ({ weekly: null, session: null })

const log = (message: string): void => console.log(message)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const definitions = liveDefinitions(host.dirs, log)
  opened.push(definitions.stop)
  const tickDeps: TickDeps = {
    store,
    now,
    resolveRepo: (repo) => resolveRepoPath(runtime, repo),
    gitlab: glabApiForRepo,
    facts: runtimeFactDeps(runtime, store),
    quota: cachedQuota(options.quota ?? NO_QUOTA),
    launch: makeLauncher(runtime, store, now)
  }
  const probe = runtimeStepProbe(runtime)
  const scheduler = new PilotScheduler({
    now,
    definitions: definitions.current,
    runTick: (def, opts) => runTick(def, definitions.current().people, tickDeps, opts),
    lastTickAt: (id) => store.lastRealTick(id)?.startedAt ?? null,
    poll: async () => {
      sweepStaleStarts(store, now, log)
      await pollRunningSteps(store, probe, claudeTranscriptCost, now)
    },
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
    loaded: definitions.current,
    reload: definitions.reload,
    scheduler
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
