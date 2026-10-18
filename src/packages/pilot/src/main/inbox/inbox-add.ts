import { notPreparedReply, queuedPreparation } from '../../shared/preparation'
import { homeOf } from '../../shared/api-types-env'
import { randomUUID } from 'node:crypto'
import type { InboxItemRow, ItemFields } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import type { InboxAddParams, InboxAddResult } from '../../shared/inbox-types'
import { CHANGED_AFTER_ANSWER } from '../../shared/pilot-replies'
import type { NewInboxItem } from '../store/store-inbox'
import { buildCard, checkDetailsChoice, inboxDigest, type InboxCard } from './card'
import { loadDetails } from './details-bundle'
import { ANSWER_LOCKED, answerLocked } from './answer-lock'
import { inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'
import { resolveInboxPerson } from './person'
import {
  checkNotPrepared,
  checkPreparationRequest,
  refuseUnpreparedEvidence,
  retireNotPrepared
} from './not-prepared'
import { fieldsForRun, latestFieldsFor } from './run-fields'

export const SKIPPED_BEFORE =
  'Skipped before with the same arguments; not offered again until they change'
export { CHANGED_AFTER_ANSWER }

type Origin = {
  // A "Not prepared" notice's key (D2): a notice and a plain card are never the same card.
  noticeKey?: string | null
  automationId: string
  runId: string | null
  stepIdx: number | null
  itemKey: string | null
  worktreePath: string | null
  fields: ItemFields
}

function newItemId(): string {
  return `in_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function stringField(fields: ItemFields, name: string): string | null {
  const value = fields[name]
  return typeof value === 'string' && value !== '' ? value : null
}

// The worktrees an automation has shown: those of the items in its newest real tick.
function knownWorktrees(deps: InboxDeps, automationId: string): Set<string> {
  const tick = deps.store.lastTick(automationId)
  const paths = tick ? deps.store.tickItems(tick.id).map((i) => i.fields['worktree.path']) : []
  return new Set(paths.filter((p): p is string => typeof p === 'string' && p !== ''))
}

// Inside a run, where the card belongs (automation, item, worktree) comes from the run alone: the
// caller's own claims are ignored, so a step can't aim a card at another worktree or item.
function originOf(deps: InboxDeps, params: InboxAddParams): Origin {
  if (params.runId) {
    const run = deps.store.runs.get(params.runId)
    if (!run) {
      throw new Error(`No run ${params.runId}`)
    }
    if (
      params.stepIdx !== undefined &&
      !deps.store.runs.steps(run.id).some((s) => s.idx === params.stepIdx)
    ) {
      throw new Error(`Run ${run.id} has no step ${params.stepIdx}`)
    }
    return {
      automationId: run.automationId,
      runId: run.id,
      stepIdx: params.stepIdx ?? null,
      itemKey: run.itemKey,
      worktreePath: homeOf(run),
      fields: fieldsForRun(deps.store, run.id)
    }
  }
  if (!params.automationId || !params.itemKey) {
    throw new Error('Outside a run, --automation and --item are required')
  }
  const fields = latestFieldsFor(deps.store, params.automationId, params.itemKey)
  if (params.worktreePath && !knownWorktrees(deps, params.automationId).has(params.worktreePath)) {
    throw new Error(`"${params.worktreePath}" is not a worktree of ${params.automationId}`)
  }
  return {
    automationId: params.automationId,
    runId: null,
    stepIdx: null,
    itemKey: params.itemKey,
    worktreePath: params.worktreePath ?? stringField(fields, 'worktree.path'),
    fields
  }
}

// Only the same action's card is the same card: an open card never turns into an ask for another action.
// A start_run card (Pilot's ask-first ask, one per run) is never the same as any other, so nothing merges
// into Pilot's ask and Pilot's ask never merges into another run's card.
function sameCard(item: InboxItemRow, card: InboxCard, origin: Origin): boolean {
  if (item.action !== card.action || card.action === 'start_run') {
    return false
  }
  return (
    item.itemKey === origin.itemKey &&
    item.worktreePath === origin.worktreePath &&
    item.type === card.type &&
    item.title === card.title &&
    (item.notPreparedKey ?? null) === (origin.noticeKey ?? null)
  )
}

function sameArgs(item: InboxItemRow, card: InboxCard): boolean {
  return (
    item.action === card.action &&
    JSON.stringify(item.actionArgs) === JSON.stringify(card.actionArgs)
  )
}

function skippedBefore(item: InboxItemRow, card: InboxCard, origin: Origin): boolean {
  return (
    item.status === 'done' &&
    (item.outcome ?? '').startsWith('skipped') &&
    sameCard(item, card, origin) &&
    sameArgs(item, card)
  )
}

// A card added again without a bundle keeps the one it has: a step's retry without its refused bundle, or
// a plain re-add, never drops the Details shown. A card with a bundle carries no markdown (ruling 6).
function keepingBundle(
  card: InboxCard,
  open: InboxItemRow,
  loaded: DetailsSnapshot | null
): InboxCard {
  if (loaded || !open.details) {
    return card
  }
  return { ...card, details: open.details, detailsMd: null }
}

// The open card again: unchanged, it is returned as is; changed, it becomes the next version (with the
// snapshot of its bundle, or none), and an answer given to the old version is cleared (that answer
// approved another card).
function updateOpen(
  deps: InboxDeps,
  open: InboxItemRow,
  card: InboxCard,
  digest: string,
  at: number,
  snapshot: DetailsSnapshot | null,
  callerRunId: string | null
): InboxAddResult {
  if (open.digest === digest) {
    // The suggestion is not part of the digest: refresh it without making a new version.
    if (open.suggested !== card.suggested) {
      deps.store.inbox.update(open.id, { suggested: card.suggested }, at)
    }
    return { id: open.id, existing: true, refused: null }
  }
  const answered = open.status === 'answered'
  const cleared = {
    status: 'open' as const,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [...open.replies, { text: CHANGED_AFTER_ANSWER, by: 'pilot' as const }]
  }
  // A card that keeps its bundle (added again without one) keeps that bundle's snapshot too.
  const keepSnapshot = snapshot === null && card.details !== null
  const written = deps.store.transaction(() => {
    // No change clears an answer that may be being carried out, unless the caller is that answer run.
    if (answerLocked(deps.store, deps.store.inbox.get(open.id) ?? open, at, callerRunId)) {
      return false
    }
    deps.store.inbox.edit(open.id, { ...card, digest }, at)
    if (!keepSnapshot) {
      deps.store.inbox.setSnapshot(open.id, snapshot)
    }
    if (answered) {
      deps.store.inbox.update(open.id, cleared, at)
    }
    return true
  })
  if (!written) {
    return { id: null, existing: true, refused: ANSWER_LOCKED }
  }
  if (answered) {
    deps.store.queue.removePending(open.id)
  }
  inboxEvent(deps.store, open, 'item_updated', { version: open.version + 1, cleared: answered }, at)
  syncRunWaiting(deps.store, open.runId, at)
  return { id: open.id, existing: true, refused: null }
}

function addInboxItemUnlocked(
  deps: InboxDeps,
  params: InboxAddParams,
  opts: {
    // Run every check, write nothing.
    dryRun?: boolean
    // The run a bundled add is bound to (refuseOutsideScope): its own dispatched answer is not in the way.
    callerRunId?: string | null
  } = {}
): InboxAddResult {
  checkPreparationRequest(params)
  checkNotPrepared(params)
  refuseUnpreparedEvidence(params)
  const origin = { ...originOf(deps, params), noticeKey: params.notPrepared?.key ?? null }
  const def = deps.definitions().find((d) => d.id === origin.automationId)
  if (!def) {
    throw new Error(`No automation "${origin.automationId}"`)
  }
  // The bundle is read and checked whole before anything else about the card, on a dry run too: a
  // refused bundle fails the add (DetailsRefused), and nothing is written.
  checkDetailsChoice(params)
  const loaded = params.detailsBundlePath
    ? loadDetails(deps.detailsRoot ?? null, params.detailsBundlePath)
    : null
  const card = buildCard(params, loaded?.ref ?? null)
  if (card.action && deps.knownAction && !deps.knownAction(card.action)) {
    throw new Error(`No action named "${card.action}" in Pilot's catalog`)
  }
  const argsProblem = card.action
    ? deps.actionArgsProblem?.(card.action, card.actionArgs ?? {})
    : null
  if (argsProblem) {
    throw new Error(argsProblem)
  }
  const digest = inboxDigest(card)
  const at = deps.now()
  const mine = deps.store.inbox.list({ automationId: origin.automationId })
  // A waiting prepared card is the same decision again (its key, or a plain re-add of it, which never downgrades it).
  // Once it has closed, a repeat is a new card.
  const managed = mine.find(
    (i) =>
      WAITING.includes(i.status) &&
      i.itemKey === origin.itemKey &&
      i.worktreePath === origin.worktreePath &&
      ((params.preparation && i.preparation?.input.key === params.preparation.key) ||
        (!params.preparation && i.preparation && sameCard(i, card, origin)))
  )
  if (managed) {
    if (params.preparation && !opts.dryRun) {
      retireNotPrepared(deps, mine, origin, params.preparation.key, managed.id, at)
    }
    return { id: managed.id, existing: true, refused: null }
  }
  const open = params.preparation
    ? undefined
    : mine.find((i) => WAITING.includes(i.status) && sameCard(i, card, origin))
  if (open) {
    const merged = keepingBundle(card, open, loaded)
    const callerRunId = opts.callerRunId ?? null
    return updateOpen(deps, open, merged, inboxDigest(merged), at, loaded, callerRunId)
  }
  if (card.action && mine.some((i) => skippedBefore(i, card, origin))) {
    return { id: null, existing: false, refused: SKIPPED_BEFORE }
  }
  const { person, routed } = resolveInboxPerson(def.inbox, origin.fields, deps.people())
  if (person === null) {
    throw new Error('No person to address the card to: people.yaml names nobody')
  }
  if (opts.dryRun) {
    return { id: null, existing: false, refused: null }
  }
  const item: NewInboxItem = {
    ...(params.preparation ? { preparation: queuedPreparation(params.preparation, at) } : {}),
    ...(params.notPrepared ? { notPreparedKey: params.notPrepared.key } : {}),
    id: (deps.newId ?? newItemId)(),
    automationId: origin.automationId,
    runId: origin.runId,
    stepIdx: origin.stepIdx,
    itemKey: origin.itemKey,
    worktreePath: origin.worktreePath,
    person,
    ...card,
    digest,
    replies: params.notPrepared
      ? [{ text: notPreparedReply(params.notPrepared.reason), by: 'pilot' as const }]
      : [],
    outcome: null,
    createdAt: at,
    source: 'engine',
    vaultRef: null
  }
  deps.store.inbox.add(item, loaded)
  if (params.preparation) {
    retireNotPrepared(deps, mine, origin, params.preparation.key, item.id, at)
  }
  inboxEvent(
    deps.store,
    item,
    'item_written',
    { type: item.type, title: item.title, person, routed },
    at
  )
  syncRunWaiting(deps.store, item.runId, at)
  return { id: item.id, existing: false, refused: null }
}

export function addInboxItem(...args: Parameters<typeof addInboxItemUnlocked>): InboxAddResult {
  const [deps, params] = args
  if (params.preparation) {
    return deps.store.transaction(() => addInboxItemUnlocked(...args))
  }
  return addInboxItemUnlocked(...args)
}
