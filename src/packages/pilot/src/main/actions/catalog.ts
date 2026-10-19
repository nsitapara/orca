import type { LinearWriter } from '../linear-connector/linear-writer'
import { linearEntries, type LinearFiles } from './linear-entries'
import type { ActionCatalog, ActionEntry } from './types'

// pilotcli's push (push-branch.ts) and mark_ready (mark-ready.ts), the Linear writes, then any extra ones. Their
// args pin the state the action was proposed against; a moved pin is `stale`.
export function buildActionCatalog(deps: {
  push: ActionEntry
  markReady: ActionEntry
  linear: LinearWriter | null
  // Where linear_create reads screenshots from; none without it.
  linearFiles?: LinearFiles
  extra?: ActionEntry[]
}): ActionCatalog {
  const all = [
    deps.push,
    deps.markReady,
    ...linearEntries(deps.linear, deps.linearFiles),
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
