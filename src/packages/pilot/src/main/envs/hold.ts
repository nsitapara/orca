import type { RunRow } from '../../shared/api-types'
import { worktreePathKey } from '../fields/agent-activity'
import type { RunStore } from '../store/store-runs'

// Another running run in this worktree, however its path is spelled (as workspace.ts claimIn compares).
export function holderOf(runs: RunStore, path: string, runId: string): RunRow | null {
  const key = worktreePathKey(path)
  for (const recorded of runs.runningWorktreePaths()) {
    if (worktreePathKey(recorded) !== key) {
      continue
    }
    const other = runs.runningInWorktree(recorded).find((r) => r.id !== runId)
    if (other) {
      return other
    }
  }
  return null
}

// Pilot's claim on the item's worktree (one agent per worktree, §6): taken when no other run holds it, in the same
// synchronous step as the look. Returns the run that holds it instead.
export function claimHome(runs: RunStore, runId: string, path: string): RunRow | null {
  const holder = holderOf(runs, path, runId)
  if (holder) {
    return holder
  }
  runs.update(runId, { worktreePath: path })
  return null
}

// What --throwaway says (M4 §8): pilotcli's busy read sees agent tabs in Pilot and Orca, not Pilot's claim on the
// worktree, which a run holds outside its agent tabs too (setup, shell steps, between steps).
export function throwawayReason(holder: RunRow, nameOf: (automationId: string) => string): string {
  return `${nameOf(holder.automationId)} is already working in it (Pilot run ${holder.id})`
}

// Why a run is deferred when create put it in a folder another Pilot run holds (any subject can come back in place).
export function heldFolderReason(
  holder: RunRow,
  nameOf: (automationId: string) => string,
  path: string
): string {
  return `${nameOf(holder.automationId)} is already working in ${path} (Pilot run ${holder.id})`
}
