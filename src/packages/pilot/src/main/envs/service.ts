import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { envRunKey } from '../../shared/run/env-args'
import type { EngineEnv } from '../engine-env'
import { resolveRepoPath } from '../fields/runtime-facts'
import { closeSessionTerminal } from '../run/launch'
import { terminalOpen } from '../run/session-tabs'
import type { PilotStore } from '../store/store'
import { ownProcessIdentity } from '../store/store-actions'
import { stopOrphanCreate } from './orphan-create'
import { pilotcliRunner, type Pilotcli } from './pilotcli'
import { createPreparations, type Preparations } from './prepare'
import { resolveEnvPath } from './resolve-path'
import { createTeardowns } from './teardown'

export type EnvServiceDeps = {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  log(message: string): void
  definitionFor(automationId: string): AutomationDefinition | null
  engineEnv: EngineEnv
  dataDir: string
  // A tab's unsent input: a throwaway's tab someone is typing in stays open, and its delete waits.
  terminalDraft(handle: string): Promise<string>
  // The rest of a run's end (answer runs' cards): runEnded calls it, then removes the run's env.
  onRunEnd?(run: RunRow): void
  pilotcli?: Pilotcli
}
export type EnvService = {
  preparations: Preparations
  // The run engine's onRunEnd (M4 §8, the run ends however it ends): the rest of the run's end, then its env's teardown,
  // which first stops a create still in flight.
  runEnded(run: RunRow): void
  // The scheduler's poll: the deletes now due (a retry, a not_yet, a run that ended outside closeRun). Never awaits one.
  housekeep(): void
  stop(): void
}

// What a reason calls another Pilot run's job (--throwaway, a deferred run): its automation's name, else its id.
export function nameOf(
  definitionFor: EnvServiceDeps['definitionFor']
): (automationId: string) => string {
  return (automationId) => definitionFor(automationId)?.name ?? automationId
}

// Job environments (pilotcli M4 §8): one per process. Pid files of creates in flight live in <data>/envs.
export function createEnvService(deps: EnvServiceDeps): EnvService {
  const { runtime } = deps
  // The same binDir engineChildEnv puts first on PATH: pilotcliEnv drops it by exact match.
  const pilotcli = deps.pilotcli ?? pilotcliRunner({ pilotBinDir: deps.engineEnv.binDir })
  const pidDir = join(deps.dataDir, 'envs')
  mkdirSync(pidDir, { recursive: true })
  const pidFileOf = (runId: string): string => join(pidDir, `${envRunKey(runId)}.pid`)
  const preparations = createPreparations({
    runs: deps.store.runs,
    pilotcli,
    resolvePath: async (repo, path, signal) =>
      resolveEnvPath(runtime, (await resolveRepoPath(runtime, repo)).id, path, signal),
    nameOf: nameOf(deps.definitionFor),
    pidFile: pidFileOf,
    preparer: () => ({ pid: process.pid, identity: ownProcessIdentity() }),
    log: deps.log
  })
  const teardowns = createTeardowns({
    store: deps.store,
    now: deps.now,
    pilotcli,
    preparations,
    stopOrphanCreate: (runId) => stopOrphanCreate(pidFileOf(runId), runId),
    tabs: {
      isOpen: (handle) => terminalOpen(runtime, handle),
      draft: (handle) => deps.terminalDraft(handle),
      close: (handle) => closeSessionTerminal(runtime, handle)
    },
    // A rescan of the run's repo, so the runtime forgets a removed folder. Best effort: any failure is ignored.
    forget: (run) => {
      const repo = deps.definitionFor(run.automationId)?.repo
      if (repo) {
        void resolveRepoPath(runtime, repo)
          .then((found) => runtime.invalidateWorktreeCatalog(found.id))
          .catch(() => {})
      }
    },
    log: deps.log
  })
  return {
    preparations,
    runEnded: (run) => {
      try {
        deps.onRunEnd?.(run)
      } finally {
        if (run.env && run.env.removedAt === null) {
          teardowns.start(run)
        }
      }
    },
    housekeep: () => teardowns.housekeep(),
    stop: () => preparations.stopAll()
  }
}
