import type { InboxItemRow, RunStatus } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import type { DetailsSnapshot } from '../../shared/details'
import { redraftedReply } from '../../shared/pilot-replies'
import { cardOf, inboxDigest } from './card'
import { loadDetails } from './details-bundle'
import { getInboxItem, inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'

export const ANSWERED_SINCE = 'answered since; Details not attached'
export const ANSWER_BEING_APPLIED = 'its answer is being applied; Details not attached'
export const HAS_DETAILS_SINCE = 'has Details since; Details not attached'

export type SetDetailsResult = { id: string; version: number; changed: boolean; cleared: boolean }
export type SetDetailsOptions = {
  // The commit a drafted patch was drafted against, named in the reply under a cleared answer.
  head: string | null
  // Refuse a card that has an answer (the vault import's backfill).
  onlyUnanswered: boolean
  // Refuse a card that has a bundle (the backfill: a draft attached meanwhile is kept).
  onlyWithoutDetails?: boolean
}

// An answer run that may still be applying its answer. A finished one (done, needs_you, failed, …) has
// had its onRunEnd (answer-run-end.ts), so its answer is no longer in flight.
const LIVE_RUN: ReadonlySet<RunStatus> = new Set(['asking', 'running'])

// The card's answer is being applied now: the card is 'answered' and a dispatched queue row names an
// answer run still running. Clearing it would leave that run to end on, or tick, a version nobody
// answered. A dispatched row outlives its run, and one with no run (sent before Pilot) never counts.
export function answerBeingApplied(store: PilotStore, item: InboxItemRow): boolean {
  if (item.status !== 'answered') {
    return false
  }
  return store.queue.forInboxItem(item.id).some((row) => {
    if (row.state !== 'dispatched' || row.dispatchedRunId === null) {
      return false
    }
    const run = store.runs.get(row.dispatchedRunId)
    return Boolean(run && LIVE_RUN.has(run.status))
  })
}

function waitingItem(deps: InboxDeps, id: string): InboxItemRow {
  const item = getInboxItem(deps, id)
  if (!WAITING.includes(item.status)) {
    throw new Error(`Inbox item ${id} is already ${item.status}`)
  }
  return item
}

// Under the write lock: the card is read again, so what is checked (still waiting, unanswered when asked)
// is what is written over. Markdown Details give way to the bundle (ruling 6).
function attach(
  deps: InboxDeps,
  id: string,
  loaded: DetailsSnapshot,
  opts: SetDetailsOptions
): { item: InboxItemRow; result: SetDetailsResult } {
  const item = waitingItem(deps, id)
  if (opts.onlyWithoutDetails && item.details !== null) {
    throw new Error(HAS_DETAILS_SINCE)
  }
  const card = { ...cardOf(item), details: loaded.ref, detailsMd: null }
  const digest = inboxDigest(card)
  if (digest === item.digest) {
    return { item, result: { id, version: item.version, changed: false, cleared: false } }
  }
  const answered = item.status === 'answered' || item.answer !== null
  if (opts.onlyUnanswered && answered) {
    throw new Error(ANSWERED_SINCE)
  }
  if (answerBeingApplied(deps.store, item)) {
    throw new Error(ANSWER_BEING_APPLIED)
  }
  const at = deps.now()
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

// Replaces a card's Details with a bundle (pilot inbox set-details, the vault import's backfill): a new
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
