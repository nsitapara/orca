import type { ImportPlan } from '../../../shared/api-types'

export type StateWorktree = { id: string; path: string; branch: string | null }

// One old sweep's saved state. `json` reads under the sweeps' state root (web-platform/.git/agent-loops,
// gate.STATE_ROOT); `note`/`notes`/`vaultPath` under the vault's Agent Work/Automations folder
// (vault.AUTOMATIONS); `dataPath` under Pilot's data folder. Missing files read as null or []. `worktrees()` are the
// managed worktrees Pilot sees now, and `now` is the import's clock.
export type StateReader = {
  json(rel: string): unknown
  note(rel: string): string | null
  notes(folder: string): string[]
  vaultPath(rel: string): string
  dataPath(rel: string): string
  worktrees(): StateWorktree[]
  now: number
}

// Turns one automation's old state into Pilot rows. Pure: it only reads through `read`.
export type SweepStateMapper = {
  automationId: string
  plan(read: StateReader): ImportPlan
}
