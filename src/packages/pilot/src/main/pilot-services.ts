import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../../../../main/runtime/rpc/methods/index'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import { liveDefinitions } from './definitions/live'
import type { LoadedDefinitions } from './definitions/loader'
import { applyPilotEnvDefaults, pilotAutomationDirs } from './env'
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
export type PilotServiceOptions = { quota?: QuotaReader; schedulerEnabled?: boolean }

// orcad has no Claude quota reader (R3): the quota check then sees nulls and lets runs start.
const NO_QUOTA: QuotaReader = async () => ({ weekly: null, session: null })

const log = (message: string): void => console.log(message)

// Shared by desktop/serve and orcad. Production time is Date.now; everything below takes it injected.
export function startPilotServices(
  runtime: OrcaRuntimeService,
  processKind: PilotStatus['process'],
  options: PilotServiceOptions = {}
): PilotServices {
  applyPilotEnvDefaults()
  const now = Date.now
  const dirs = pilotAutomationDirs()
  const store = PilotStore.open(
    join(getAppEnvironment().getPath('userData'), 'pilot-automations.db')
  )
  const definitions = liveDefinitions(dirs, log)
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
  const context: PilotContext = {
    processKind,
    store,
    dirs,
    loaded: definitions.current,
    reload: definitions.reload,
    scheduler
  }
  registerPilotRpcMethods(ALL_RPC_METHODS as unknown[], buildPilotMethods(context))
  if (options.schedulerEnabled ?? true) {
    sweepStaleStarts(store, now, log)
    scheduler.start()
  } else {
    log(`[pilot] scheduler off in ${processKind} (PILOT_SCHEDULER=on runs it here)`)
  }
  const count = definitions.current().definitions.length
  log(`[pilot] attached (${processKind}): ${count} automation(s) from ${dirs.join(', ')}`)
  let stopped = false
  return {
    context,
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      scheduler.stop()
      definitions.stop()
      store.close()
      log(`[pilot] stopped (${processKind})`)
    }
  }
}
