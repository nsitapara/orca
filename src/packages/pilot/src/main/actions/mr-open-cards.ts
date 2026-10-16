import type { InboxItemRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { jobCode } from '../../shared/job-name'
import { WAITING } from '../inbox/inbox-service'
import { fieldsForRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import type { ActionCaller } from './types'

export type OpenCardsDeps = {
  store: PilotStore
  definitions(): readonly AutomationDefinition[]
}

// mark-ready.py's BLOCKING_JOBS: their open cards mean the branch still has work in it.
const BLOCKING_JOBS: ReadonlySet<string> = new Set(['03', '04', '05', '06'])

// A card is on !iid when it is about that MR (an MR job's item mr:<iid>), or its run's item names the MR as its
// branch's (a worktree job's item carries mr.iid). Pilot's own store, so no pilotcli call.
function onMr(store: PilotStore, card: InboxItemRow, iid: number): boolean {
  if (card.itemKey === `mr:${iid}`) {
    return true
  }
  if (!card.runId) {
    return false
  }
  const named = fieldsForRun(store, card.runId)['mr.iid']
  return named === iid || named === String(iid)
}

// The waiting cards from jobs 03–06 on MR !iid (mark-ready.py's open items: not a folded default, not done), less the
// card being approved, as mark-ready.py's blocker: "<n> open item(s) from 03, 06". Null when there are none.
export function openCardsOn(deps: OpenCardsDeps, iid: number, caller: ActionCaller): string | null {
  const codes = new Map(deps.definitions().map((d) => [d.id, jobCode(d.name)]))
  const open = deps.store.inbox
    .list({ status: WAITING })
    .filter(
      (card) =>
        card.id !== caller.inboxItemId &&
        card.type !== 'default' &&
        BLOCKING_JOBS.has(codes.get(card.automationId) ?? '') &&
        onMr(deps.store, card, iid)
    )
  if (open.length === 0) {
    return null
  }
  const jobs = [...new Set(open.map((card) => codes.get(card.automationId)))].sort().join(', ')
  return `${open.length} open item${open.length === 1 ? '' : 's'} from ${jobs}`
}
