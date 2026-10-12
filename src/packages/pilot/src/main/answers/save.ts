import type { InboxAnswer, InboxItemRow } from '../../shared/api-types'
import type { InboxAnswerParams } from '../../shared/inbox-types'
import { oneLine } from '../inbox/card'
import { routeFor, type CatalogLookup } from './queue-view'
import {
  getInboxItem,
  inboxEvent,
  syncRunWaiting,
  WAITING,
  type InboxDeps
} from '../inbox/inbox-service'

// gate.py ANSWERS_SETTLE: a saved answer waits this long, so one still being typed is never sent.
export const SETTLE_MS = 180_000
export const CARD_CHANGED_ON_SAVE = 'The card changed; review it again'
export const APPROVE_ON_DESKTOP = 'Approve actions in Pilot on this Mac'
export const NO_ANSWER_CALLER = "Pilot can't tell who is answering; nothing was saved"

// Who is answering and what the catalog can run: the caller kind is the transport's stamp (null: it named
// no one), never a param.
export type AnswerOrigin = {
  callerKind: NonNullable<InboxAnswer['callerKind']> | null
  catalog: CatalogLookup
}

function answerText(item: InboxItemRow, params: InboxAnswerParams): string {
  const typed = oneLine(params.text)
  if (typed || params.option === undefined) {
    return typed
  }
  const option = item.options[params.option]
  if (!option) {
    throw new Error(`Option ${params.option + 1} isn't on this card`)
  }
  return option.label
}

function clearAnswer(deps: InboxDeps, item: InboxItemRow, at: number): InboxItemRow {
  const patch = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
  deps.store.inbox.update(item.id, patch, at)
  inboxEvent(deps.store, item, 'answer_cleared', {}, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...patch, updatedAt: at }
}

// The digest check is this function's; `InboxStore.update` writes the answer (a re-answer replaces an earlier
// one on a card that is already 'answered', which `InboxStore.saveAnswer` would refuse).
export function saveAnswer(
  deps: InboxDeps,
  params: InboxAnswerParams,
  origin: AnswerOrigin
): InboxItemRow {
  const { callerKind } = origin
  if (callerKind === null) {
    throw new Error(NO_ANSWER_CALLER)
  }
  const item = getInboxItem(deps, params.id)
  if (!WAITING.includes(item.status)) {
    throw new Error(`This card is ${item.status}; it takes no answer`)
  }
  if (params.digest && params.digest !== item.digest) {
    throw new Error(CARD_CHANGED_ON_SAVE)
  }
  const via = params.via ?? 'cli'
  if (via === 'page' && !params.digest) {
    throw new Error('A page answer names the card version it answers')
  }
  const text = answerText(item, params)
  const at = deps.now()
  // Typed words win over a picked option, so a stale option can't route a different answer.
  const option = oneLine(params.text) ? null : (params.option ?? null)
  // Only Pilot on this Mac approves: an answer that runs an action or starts a run is refused elsewhere.
  if (
    text &&
    callerKind !== 'desktop' &&
    routeFor(item, origin.catalog, { text, option }).kind === 'script'
  ) {
    throw new Error(APPROVE_ON_DESKTOP)
  }
  deps.store.queue.removePending(item.id)
  if (!text) {
    return clearAnswer(deps, item, at)
  }
  const answer: InboxAnswer = { option, text, digest: item.digest, via, callerKind }
  const patch = {
    status: 'answered' as const,
    answer,
    answeredAt: at,
    answeredBy: params.by ?? item.person
  }
  deps.store.inbox.update(item.id, patch, at)
  deps.store.queue.enqueue(item.id, at + SETTLE_MS, at)
  inboxEvent(deps.store, item, 'answer_saved', { text, via, option: answer.option }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...patch, updatedAt: at }
}
