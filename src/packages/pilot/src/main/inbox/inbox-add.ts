import { randomUUID } from 'node:crypto'
import type { InboxItemRow, ItemFields } from '../../shared/api-types'
import type { InboxAddParams, InboxAddResult } from '../../shared/inbox-types'
import { CHANGED_AFTER_ANSWER } from '../../shared/pilot-replies'
import type { NewInboxItem } from '../store/store-inbox'
import { buildCard, inboxDigest, type InboxCard } from './card'
import { inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'
import { resolveInboxPerson } from './person'
import { fieldsForRun, latestFieldsFor } from './run-fields'

export const SKIPPED_BEFORE =
  'Skipped before with the same arguments; not offered again until they change'
export const SAME_CARD_OPEN = 'same card already open'
export { CHANGED_AFTER_ANSWER }

type Origin = {
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
  const tick = deps.store.lastRealTick(automationId)
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
      worktreePath: run.worktreePath,
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
    item.title === card.title
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

// The open card again: unchanged, it is returned as is; changed, it becomes the next version, and an
// answer given to the old version is cleared (that answer approved another card).
function updateOpen(
  deps: InboxDeps,
  open: InboxItemRow,
  card: InboxCard,
  digest: string,
  at: number
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
  deps.store.transaction(() => {
    deps.store.inbox.edit(open.id, { ...card, digest }, at)
    if (answered) {
      deps.store.inbox.update(open.id, cleared, at)
    }
  })
  if (answered) {
    deps.store.queue.removePending(open.id)
  }
  inboxEvent(deps.store, open, 'item_updated', { version: open.version + 1, cleared: answered }, at)
  syncRunWaiting(deps.store, open.runId, at)
  return { id: open.id, existing: true, refused: null }
}

export function addInboxItem(
  deps: InboxDeps,
  params: InboxAddParams,
  opts: {
    source?: InboxItemRow['source']
    vaultRef?: string
    // The import never edits a card that is already open: it refuses instead.
    noMerge?: boolean
    // Run every check, write nothing.
    dryRun?: boolean
  } = {}
): InboxAddResult {
  const origin = originOf(deps, params)
  const def = deps.definitions().find((d) => d.id === origin.automationId)
  if (!def) {
    throw new Error(`No automation "${origin.automationId}"`)
  }
  const card = buildCard(params)
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
  const open = mine.find((i) => WAITING.includes(i.status) && sameCard(i, card, origin))
  if (open && opts.noMerge) {
    return { id: null, existing: true, refused: SAME_CARD_OPEN }
  }
  if (open) {
    return updateOpen(deps, open, card, digest, at)
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
    id: (deps.newId ?? newItemId)(),
    automationId: origin.automationId,
    runId: origin.runId,
    stepIdx: origin.stepIdx,
    itemKey: origin.itemKey,
    worktreePath: origin.worktreePath,
    person,
    ...card,
    digest,
    replies: [],
    outcome: null,
    createdAt: at,
    source: opts.source ?? 'engine',
    vaultRef: opts.vaultRef ?? null
  }
  deps.store.inbox.add(item)
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
