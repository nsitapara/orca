import { existsSync } from 'node:fs'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { pilotcliRunner } from '../envs/pilotcli'
import type { PilotStore } from '../store/store'
import { runtimeLinearConnector } from '../linear-connector/linear-connector'
import { linearTicketSource } from './linear-tickets'
import { inboxPreparationSource } from './inbox-preparations'
import { keptBranchSource, keptRefsOf } from './kept-branches'
import { registerItemSource } from './registry'
import { runtimeWorktreeRecords } from './worktree-records'
import { worktreeSource } from './worktrees'

// pilotBinDir: the engine env's bin dir, which the pilotcli runner keeps off its PATH (envs/pilotcli.ts).
export type PilotSourceDeps = {
  runtime: OrcaRuntimeService
  store: PilotStore
  pilotBinDir: string
}

// Sources that read the runtime or the store, registered once the store is open and before the
// definitions load (openPilot). GitLab-only sources are built into registry.ts.
export function registerPilotSources(deps: PilotSourceDeps): void {
  const listWorktrees = runtimeWorktreeRecords(deps.runtime)
  registerItemSource(inboxPreparationSource(deps.store, listWorktrees))
  registerItemSource(
    keptBranchSource({
      store: deps.store,
      listWorktrees,
      pilotcli: pilotcliRunner({ pilotBinDir: deps.pilotBinDir }),
      keptBranches: (path) =>
        gitExecFileAsync(
          ['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads/pilot/'],
          { cwd: path }
        ).then(
          (r) => keptRefsOf(r.stdout),
          () => null
        ),
      headOf: (path) =>
        gitExecFileAsync(['rev-parse', 'HEAD'], { cwd: path }).then(
          (r) => r.stdout.trim() || null,
          () => null
        ),
      now: Date.now
    })
  )
  registerItemSource(
    worktreeSource({
      listWorktrees,
      git: gitExecFileAsync,
      markers: (automationId) => deps.store.markers.progressMarkers(automationId),
      pathExists: existsSync,
      envFolder: (path) => deps.store.runs.envs.isThrowawayFolder(path)
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
