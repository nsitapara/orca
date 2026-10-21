import type { ItemFields } from '../../shared/api-types'
import type { CardRun } from '../../shared/inbox-types'
import type { PilotStore } from '../store/store'
import { withDetail } from '../timeline/run-detail'

// What a card's place line links from: its item's MR and branch. The rest of the item's fields stay on the server.
const LINK_FIELDS = [
  'mr.iid',
  'mr.title',
  'mr.web_url',
  'mr.state',
  'mr.draft',
  'mr.pipeline_status',
  'mr.branch',
  'worktree.branch'
]

function linkFields(all: ItemFields | undefined): ItemFields | null {
  const picked = LINK_FIELDS.flatMap((key) => {
    const value = all?.[key]
    return value === undefined || value === null ? [] : [[key, value] as const]
  })
  return picked.length > 0 ? Object.fromEntries(picked) : null
}

// The run each listed card came from, with its steps and what it asked: the card's "From run" strip (spec §3). A run
// that is gone is left out, and its card shows no strip.
export function cardRuns(
  store: PilotStore,
  items: readonly { runId: string | null }[]
): Record<string, CardRun> {
  const ids = [...new Set(items.flatMap((i) => (i.runId ? [i.runId] : [])))]
  const rows = ids.flatMap((id) => {
    const run = store.runs.get(id)
    return run ? [run] : []
  })
  const itemFields = store.advance.runItemFields(ids)
  return Object.fromEntries(
    withDetail(store, rows).map((r) => {
      const fields = linkFields(itemFields.get(r.id))
      return [r.id, fields ? { ...r, fields } : r]
    })
  )
}
