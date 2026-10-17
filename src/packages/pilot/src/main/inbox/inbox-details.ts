import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { redraftedReply } from '../../shared/pilot-replies'
import { ANSWER_LOCKED, answerLocked } from './answer-lock'
import { cardOf, inboxDigest } from './card'
import { loadDetails } from './details-bundle'
import { getInboxItem, inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'

export type SetDetailsResult = { id: string; version: number; changed: boolean; cleared: boolean }
export type SetDetailsOptions = {
  // The commit a drafted patch was drafted against, named in the reply under a cleared answer.
  head: string | null
  // The run the call is bound to (refuseOutsideScope): its own dispatched answer is not in the way.
  callerRunId?: string | null
}

function waitingItem(deps: InboxDeps, id: string): InboxItemRow {
  const item = getInboxItem(deps, id)
  if (!WAITING.includes(item.status)) {
    throw new Error(`Inbox item ${id} is already ${item.status}`)
  }
  return item
}

// Under the write lock: the card is read again, so what is checked (still waiting) is what is written over.
// Markdown Details give way to the bundle (ruling 6).
function attach(
  deps: InboxDeps,
  id: string,
  loaded: DetailsSnapshot,
  opts: SetDetailsOptions
): { item: InboxItemRow; result: SetDetailsResult } {
  const item = waitingItem(deps, id)
  if (item.preparation) {
    throw new Error('Managed context must be attached with prepare-complete')
  }
  const card = { ...cardOf(item), details: loaded.ref, detailsMd: null }
  const digest = inboxDigest(card)
  if (digest === item.digest) {
    return { item, result: { id, version: item.version, changed: false, cleared: false } }
  }
  const answered = item.status === 'answered' || item.answer !== null
  const at = deps.now()
  if (answerLocked(deps.store, item, at, opts.callerRunId ?? null)) {
    throw new Error(ANSWER_LOCKED)
  }
  const { inbox, queue } = deps.store
  inbox.edit(id, { details: loaded.ref, detailsMd: null, digest }, at)
  inbox.setSnapshot(id, loaded)
  if (answered) {
    const reply = { text: redraftedReply(opts.head), by: 'pilot' as const }
    const reopened = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
    inbox.update(id, { ...reopened, replies: [...item.replies, reply] }, at)
    queue.removePending(id)
  }
  return { item, result: { id, version: item.version + 1, changed: true, cleared: answered } }
}

// Replaces a card's Details with a bundle (pilot inbox set-details): a new
// version of the card, its snapshot replaced in the same transaction. An answer given to the old version
// is cleared with Pilot's reply, and its pending queue row goes, since it approved what was shown before.
export function setInboxDetails(
  deps: InboxDeps,
  id: string,
  bundlePath: string,
  opts: SetDetailsOptions
): SetDetailsResult {
  waitingItem(deps, id)
  const loaded = loadDetails(deps.detailsRoot ?? null, bundlePath)
  const { item, result } = deps.store.transaction(() => attach(deps, id, loaded, opts))
  if (!result.changed) {
    return result
  }
  const at = deps.now()
  const payload = { version: result.version, reason: 'details', cleared: result.cleared }
  inboxEvent(deps.store, item, 'item_updated', payload, at)
  syncRunWaiting(deps.store, item.runId, at)
  return result
}
