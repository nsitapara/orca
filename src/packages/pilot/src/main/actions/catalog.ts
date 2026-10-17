import type { LinearWriter } from '../linear-connector/linear-writer'
import { linearEntries } from './linear-entries'
import type { ActionCatalog, ActionEntry } from './types'

// pilotcli's push (push-branch.ts), mark_ready (mark-ready.ts) and post_review (post-review.ts), the Linear writes,
// then any extra ones. Their args pin the state the action was proposed against; a moved pin is `stale`.
export function buildActionCatalog(deps: {
  push: ActionEntry
  markReady: ActionEntry
  postReview: ActionEntry
  linear: LinearWriter | null
  extra?: ActionEntry[]
}): ActionCatalog {
  const all = [
    deps.push,
    deps.markReady,
    deps.postReview,
    ...linearEntries(deps.linear),
    ...(deps.extra ?? [])
  ]
  const byName = new Map<string, ActionEntry>()
  for (const entry of all) {
    if (byName.has(entry.name)) {
      throw new Error(`Two catalog entries are named "${entry.name}"`)
    }
    byName.set(entry.name, entry)
  }
  return { entries: () => [...all], get: (name) => byName.get(name) ?? null }
}
