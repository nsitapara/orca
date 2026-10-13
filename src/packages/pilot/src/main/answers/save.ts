import { APPROVE, answerWord } from '../../shared/answers/route'
import { PREPARATION_NOT_READY, requeuedPreparation } from '../../shared/preparation'
import type { InboxAnswer, InboxItemRow } from '../../shared/api-types'
import type { InboxAnswerParams } from '../../shared/inbox-types'
import { oneLine } from '../inbox/card'
import {
  APPROVE_ON_DESKTOP,
  DRAFT_ON_DESKTOP,
  DRAFT_OPTION_ON_DESKTOP,
  routeFor,
  type CatalogLookup
} from './queue-view'

export { APPROVE_ON_DESKTOP, DRAFT_ON_DESKTOP, DRAFT_OPTION_ON_DESKTOP }

// A re-ask the save refuses outright: words that would approve where only the desktop approves.
const DESKTOP_ONLY: ReadonlySet<string> = new Set([
  APPROVE_ON_DESKTOP,
  DRAFT_ON_DESKTOP,
  DRAFT_OPTION_ON_DESKTOP
])
import { ANSWER_LOCKED, answerLocked } from '../inbox/answer-lock'
import {
  getInboxItem,
  inboxEvent,
  syncRunWaiting,
  WAITING,
  type InboxDeps
} from '../inbox/inbox-service'

// gate.py ANSWERS_SETTLE: a saved answer waits this long, so one still being typed is never sent.
export const SETTLE_MS = 180_000
export { ANSWER_LOCKED }
export const CARD_CHANGED_ON_SAVE = 'The card changed; review it again'
export const LOCAL_CLI_NO_ANSWER = 'Answer cards in Pilot (Inbox)'
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

// Typed words win over a picked option, so a stale option can't route a different answer; the one exception is
// text that is exactly the picked option's label (what the page sends for a click).
function optionKept(item: InboxItemRow, params: InboxAnswerParams): number | null {
  const typed = oneLine(params.text)
  if (!typed) {
    return params.option ?? null
  }
  const label = params.option === undefined ? undefined : item.options[params.option]?.label
  if (label !== undefined && label.trim().toLowerCase() === typed.toLowerCase()) {
    return params.option ?? null
  }
  return null
}

function clearAnswer(deps: InboxDeps, item: InboxItemRow, at: number): InboxItemRow {
  const patch = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
  deps.store.transaction(() => {
    deps.store.queue.removePending(item.id)
    deps.store.inbox.update(item.id, patch, at)
    if (item.preparation?.state === 'cancelled') {
      deps.store.inboxPreparations.write(item.id, requeuedPreparation(item.preparation, at))
    }
  })
  inboxEvent(deps.store, item, 'answer_cleared', {}, at)
  syncRunWaiting(deps.store, item.runId, at)
  return deps.store.inbox.get(item.id) ?? { ...item, ...patch, updatedAt: at }
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
  // The local CLI is where agents run, and nothing proves a caller there is Nish: it never answers.
  if (callerKind === 'local-cli') {
    throw new Error(LOCAL_CLI_NO_ANSWER)
  }
  const item = getInboxItem(deps, params.id)
  if (!WAITING.includes(item.status)) {
    throw new Error(`This card is ${item.status}; it takes no answer`)
  }
  if (params.digest && params.digest !== item.digest) {
    throw new Error(CARD_CHANGED_ON_SAVE)
  }
  if (answerLocked(deps.store, item, deps.now())) {
    throw new Error(ANSWER_LOCKED)
  }
  // How it was given follows from the transport's caller, never from params.
  const via = callerKind === 'desktop' ? 'page' : 'device'
  if (via === 'page' && !params.digest) {
    throw new Error('A page answer names the card version it answers')
  }
  const text = answerText(item, params)
  const at = deps.now()
  const option = optionKept(item, params)
  // Only Pilot on this Mac approves: for any other caller routeFor turns a script route, or an Approve of a
  // drafted change, into one of these re-asks.
  const route = routeFor(item, origin.catalog, { text, option, callerKind })
  if (text && route.kind === 'reask' && DESKTOP_ONLY.has(route.reason)) {
    throw new Error(route.reason)
  }
  if (!text) {
    return clearAnswer(deps, item, at)
  }
  if (
    item.preparation &&
    item.preparation.state !== 'ready' &&
    (route.kind === 'script' || APPROVE.has(answerWord(text)) || option !== null)
  ) {
    throw new Error(PREPARATION_NOT_READY)
  }
  const answer: InboxAnswer = { option, text, digest: item.digest, via, callerKind }
  // `by` is recorded for display only; nothing may use it to authorize anything (the caller kind does).
  const patch = {
    status: 'answered' as const,
    answer,
    answeredAt: at,
    answeredBy: params.by ?? item.person
  }
  deps.store.transaction(() => {
    deps.store.queue.removePending(item.id)
    deps.store.inbox.update(item.id, patch, at)
    deps.store.inboxPreparations.cancel(item.id, at)
    deps.store.queue.enqueue(item.id, at + SETTLE_MS, at)
  })
  inboxEvent(deps.store, item, 'answer_saved', { text, via, option: answer.option }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return deps.store.inbox.get(item.id) ?? { ...item, ...patch, updatedAt: at }
}
