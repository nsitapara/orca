import type { ImportedHandled, ImportedSeen } from '../../../shared/api-types'
import { emptyPlan } from './plans'
import type { StateReader, SweepStateMapper } from './types'

const SHA = /^[0-9a-f]{40}$/
const SEEN = 'standards/seen.json'
const CYCLES = 'standards/cycles.json'

// A sweep state file as a JSON object: {} when it doesn't exist; anything else but an object is noted and read as {}.
function objectAt(read: StateReader, rel: string, notes: string[]): Record<string, unknown> {
  const value = read.json(rel)
  if (value === null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    notes.push(`${rel}: expected a JSON object`)
    return {}
  }
  return value as Record<string, unknown>
}

function cycleNotes(read: StateReader, seen: Record<string, unknown>, notes: string[]): void {
  for (const [path, cycle] of Object.entries(objectAt(read, CYCLES, notes))) {
    const c = (cycle ?? {}) as { round?: unknown; head?: unknown }
    if (typeof c.head === 'string' && c.head !== seen[path]) {
      notes.push(
        `${path}: its cycle (round ${String(c.round ?? '?')}) never completed; Pilot's first cycle there reviews those commits again (the sweep's "stale"); if it is still running, let it finish before 03 is enabled in Pilot`
      )
    }
  }
}

// 03's seen.json, { "<worktree path>": "<sha>" }: each worktree is handled through that sha (once_per
// "{worktree.at_head}", i.e. "<worktree id>@<sha>", status done), so Pilot's marker starts where the sweep's last review
// ended, and is seen. A cycle in cycles.json whose head isn't the reviewed sha never completed: Pilot's first cycle
// there reviews those commits again, as the sweep's "stale" restart would. cycles.json stays the skill's.
export const reviewBranchCodeMapper: SweepStateMapper = {
  automationId: 'review-branch-code',
  plan(read) {
    const notes: string[] = []
    const handled: ImportedHandled[] = []
    const seenRows: ImportedSeen[] = []
    const byPath = new Map(read.worktrees().map((w) => [w.path, w]))
    const seen = objectAt(read, SEEN, notes)
    for (const [path, sha] of Object.entries(seen)) {
      const wt = byPath.get(path)
      if (!wt) {
        notes.push(`no Orca worktree at ${path}; its review marker isn't imported`)
        continue
      }
      if (typeof sha !== 'string' || !SHA.test(sha)) {
        notes.push(`${path}: ${JSON.stringify(sha)} isn't a commit sha; skipped`)
        continue
      }
      handled.push({ onceKey: `${wt.id}@${sha}`, status: 'done', at: read.now, failedAt: null })
      seenRows.push({ itemKey: `wt:${wt.id}`, at: read.now })
    }
    cycleNotes(read, seen, notes)
    return { ...emptyPlan('review-branch-code', notes), handled, seen: seenRows }
  }
}
