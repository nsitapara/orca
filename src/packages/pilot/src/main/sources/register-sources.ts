import { existsSync } from 'node:fs'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { runtimeLinearConnector } from '../linear-connector/linear-connector'
import { linearTicketSource } from './linear-tickets'
import { registerItemSource } from './registry'
import { runtimeWorktreeRecords } from './worktree-records'
import { worktreeSource } from './worktrees'

export type PilotSourceDeps = { runtime: OrcaRuntimeService; store: PilotStore }

// Sources that read the runtime or the store, registered once the store is open and before the
// definitions load (openPilot). GitLab-only sources are built into registry.ts.
export function registerPilotSources(deps: PilotSourceDeps): void {
  const listWorktrees = runtimeWorktreeRecords(deps.runtime)
  registerItemSource(
    worktreeSource({
      listWorktrees,
      git: gitExecFileAsync,
      markers: (automationId) => deps.store.markers.progressMarkers(automationId),
      pathExists: existsSync
    })
  )
  registerItemSource(
    linearTicketSource({
      linear: runtimeLinearConnector(deps.runtime),
      listWorktrees,
      git: gitExecFileAsync
    })
  )
}
