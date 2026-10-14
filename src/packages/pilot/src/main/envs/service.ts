import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import { envRunKey } from '../../shared/run/env-args'
import type { EngineEnv } from '../engine-env'
import { resolveRepoPath } from '../fields/runtime-facts'
import type { PilotStore } from '../store/store'
import { ownProcessIdentity } from '../store/store-actions'
import { pilotcliRunner, type Pilotcli } from './pilotcli'
import { createPreparations, type Preparations } from './prepare'
import { resolveEnvPath } from './resolve-path'

export type EnvServiceDeps = {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  log(message: string): void
  definitionFor(automationId: string): AutomationDefinition | null
  engineEnv: EngineEnv
  dataDir: string
  pilotcli?: Pilotcli
}
export type EnvService = { preparations: Preparations; stop(): void }

// What a reason calls another Pilot run's job (--throwaway, a deferred run): its automation's name, else its id.
export function nameOf(
  definitionFor: EnvServiceDeps['definitionFor']
): (automationId: string) => string {
  return (automationId) => definitionFor(automationId)?.name ?? automationId
}

// Job environments (pilotcli M4 §8): one per process. Pid files of creates in flight live in <data>/envs.
export function createEnvService(deps: EnvServiceDeps): EnvService {
  // The same binDir engineChildEnv puts first on PATH: pilotcliEnv drops it by exact match.
  const pilotcli = deps.pilotcli ?? pilotcliRunner({ pilotBinDir: deps.engineEnv.binDir })
  const pidDir = join(deps.dataDir, 'envs')
  mkdirSync(pidDir, { recursive: true })
  const preparations = createPreparations({
    runs: deps.store.runs,
    pilotcli,
    resolvePath: async (repo, path, signal) =>
      resolveEnvPath(deps.runtime, (await resolveRepoPath(deps.runtime, repo)).id, path, signal),
    nameOf: nameOf(deps.definitionFor),
    pidFile: (runId) => join(pidDir, `${envRunKey(runId)}.pid`),
    preparer: () => ({ pid: process.pid, identity: ownProcessIdentity() }),
    log: deps.log
  })
  return { preparations, stop: () => preparations.stopAll() }
}
