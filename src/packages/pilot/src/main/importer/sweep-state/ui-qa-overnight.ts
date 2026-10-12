import type { ImportedHandled, ImportedSeen } from '../../../shared/api-types'
import { emptyPlan } from './plans'
import type { StateReader, SweepStateMapper } from './types'

const SHA = /^[0-9a-f]{40}$/
const SEEN = 'ui-qa/seen.json'
const FAILED = 'ui-qa/failed.json'
const RUN = 'ui-qa/run.json'
const FIXES = 'ui-qa/fixes.json'

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

// A run or an automatic fix the old app left open: Pilot neither closes nor tracks it, so it is closed out first.
function openNotes(read: StateReader, notes: string[]): void {
  const run = read.json(RUN) as { status?: unknown; branch?: unknown } | null
  if (run && typeof run === 'object' && run.status !== 'done') {
    notes.push(
      `run.json: a QA run on ${String(run.branch ?? '?')} is still open; close it out with the old app's \`loop.py sweep\` before go-live`
    )
  }
  for (const [report, fix] of Object.entries(objectAt(read, FIXES, notes))) {
    const f = (fix ?? {}) as { status?: unknown; branch?: unknown }
    if (f.status === 'dispatching' || f.status === 'dispatched') {
      notes.push(
        `fixes.json: the automatic fix for ${String(f.branch ?? report)} is still ${String(f.status)}; Pilot doesn't track it`
      )
    }
  }
}

// 04's state: seen.json { "<worktree path>": "<sha>" } becomes done handled rows (once_per "{worktree.at_head}",
// "<worktree id>@<sha>"), so Pilot's marker starts at the last tested head, and seen rows; failed.json { "<path>":
// { head, at (epoch s), outcome } } becomes failed rows at that time, so retry_after_failure's 12 hours run from the old
// failure (the marker store never reads a failed row as progress). The import only adds missing rows, so where a head is
// both tested and failed the tested row (first) wins. A run or a fix the old app left open is reported.
export const uiQaOvernightMapper: SweepStateMapper = {
  automationId: 'ui-qa-overnight',
  plan(read) {
    const notes: string[] = []
    const handled: ImportedHandled[] = []
    const seenRows: ImportedSeen[] = []
    const byPath = new Map(read.worktrees().map((w) => [w.path, w]))
    const worktreeOf = (path: string): string | null => {
      const wt = byPath.get(path)
      if (!wt) {
        notes.push(`no Orca worktree at ${path}; its QA state isn't imported`)
      }
      return wt?.id ?? null
    }
    for (const [path, sha] of Object.entries(objectAt(read, SEEN, notes))) {
      const id = worktreeOf(path)
      if (!id) {
        continue
      }
      if (typeof sha !== 'string' || !SHA.test(sha)) {
        notes.push(`${path}: ${JSON.stringify(sha)} isn't a commit sha; skipped`)
        continue
      }
      handled.push({ onceKey: `${id}@${sha}`, status: 'done', at: read.now, failedAt: null })
      seenRows.push({ itemKey: `wt:${id}`, at: read.now })
    }
    for (const [path, entry] of Object.entries(objectAt(read, FAILED, notes))) {
      const id = worktreeOf(path)
      if (!id) {
        continue
      }
      const e = (entry ?? {}) as { head?: unknown; at?: unknown }
      if (typeof e.head !== 'string' || !SHA.test(e.head) || typeof e.at !== 'number') {
        notes.push(`${path}: failed.json's entry has no head sha and time; skipped`)
        continue
      }
      const at = Math.round(e.at * 1000)
      handled.push({ onceKey: `${id}@${e.head}`, status: 'failed', at, failedAt: at })
    }
    openNotes(read, notes)
    return { ...emptyPlan('ui-qa-overnight', notes), handled, seen: seenRows }
  }
}
