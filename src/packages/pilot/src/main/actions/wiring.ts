import { existsSync } from 'node:fs'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { EngineEnv } from '../engine-env'
import { pilotcliPath, pilotcliRunner } from '../envs/pilotcli'
import { listedRepoPath } from '../fields/runtime-facts'
import { createLinearWriter } from '../linear-connector/linear-writer'
import { buildActionCatalog } from './catalog'
import { callerFolder } from './caller-folder'
import { markReadyEntry } from './mark-ready'
import { storeBranchOf, worktreeOn } from './mr-branch'
import { openCardsOn } from './mr-open-cards'
import { pushBranchEntry } from './push-branch'
import { startRunEntry } from './start-run-entry'
import type { ActionCaller, ActionCatalog } from './types'

// The one catalog Pilot's services build: pilotcli's push and mark_ready, the Linear writes and start_run.
// Built once; nothing runs until an action is attempted. start_run reaches the engine lazily. mark_ready reads the
// card or run that asks from Pilot's store: its folder, and the MR's branch and open cards there.
export function pilotActionCatalog(deps: {
  engineEnv: EngineEnv
  runtime: OrcaRuntimeService
  startRun: Parameters<typeof startRunEntry>[0]
}): ActionCatalog {
  // One lookup for a card's Run line and the call itself, read at each use (pilotcli.ts).
  const binary = () => pilotcliPath()
  const pilotcli = pilotcliRunner({ pilotBinDir: deps.engineEnv.binDir, binary })
  const store = deps.startRun.store
  const definitions = () => deps.startRun.definitions()
  const folderDeps = {
    store,
    definitions,
    repoPath: (repo: string) => listedRepoPath(deps.runtime, repo),
    exists: existsSync
  }
  const folder = (caller: ActionCaller) => callerFolder(folderDeps, caller)
  const mrDeps = { store, definitions, exists: existsSync }
  return buildActionCatalog({
    push: pushBranchEntry({ pilotcli, binary }),
    markReady: markReadyEntry({
      pilotcli,
      binary,
      folder,
      cards: {
        branchOf: (iid, caller) => storeBranchOf(mrDeps, iid, caller),
        worktreeOn: (branch) => worktreeOn(mrDeps, branch),
        openOn: (iid, branch, caller) => openCardsOn(mrDeps, iid, branch, caller)
      }
    }),
    linear: createLinearWriter(deps.runtime),
    extra: [startRunEntry(deps.startRun)]
  })
}
