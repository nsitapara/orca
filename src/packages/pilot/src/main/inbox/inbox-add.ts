import { randomUUID } from 'node:crypto'
import type { ItemFields } from '../../shared/api-types'
import type { InboxItemRow } from '../../shared/api-types'
import type { InboxAddParams, InboxAddResult } from '../../shared/inbox-types'
import type { NewInboxItem } from '../store/store-inbox'
import { buildCard, inboxDigest, type InboxCard } from './card'
import { inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'
import { resolveInboxPerson } from './person'
import { fieldsForRun, latestFieldsFor } from './run-fields'

export const SKIPPED_BEFORE =
  'Skipped before with the same arguments; not offered again until they change'
export const CHANGED_AFTER_ANSWER = 'The card changed after you answered; answer this version.'

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

function originOf(deps: InboxDeps, params: InboxAddParams): Origin {
  if (params.runId) {
    const run = deps.store.runs.get(params.runId)
    if (!run) {
      throw new Error(`No run ${params.runId}`)
    }
    return {
      automationId: run.automationId,
      runId: run.id,
      stepIdx: params.stepIdx ?? null,
      itemKey: params.itemKey ?? run.itemKey,
      worktreePath: params.worktreePath ?? run.worktreePath,
      fields: fieldsForRun(deps.store, run.id)
    }
  }
  if (!params.automationId || !params.itemKey) {
    throw new Error('Outside a run, --automation and --item are required')
  }
  const fields = latestFieldsFor(deps.store, params.automationId, params.itemKey)
  return {
    automationId: params.automationId,
    runId: null,
    stepIdx: null,
    itemKey: params.itemKey,
    worktreePath: params.worktreePath ?? stringField(fields, 'worktree.path'),
    fields
  }
}

function sameCard(item: InboxItemRow, card: InboxCard, origin: Origin): boolean {
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
    return { id: open.id, existing: true, refused: null }
  }
  const answered = open.status === 'answered'
  const cleared = {
    status: 'open' as const,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [...open.replies, CHANGED_AFTER_ANSWER]
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
  opts: { source?: InboxItemRow['source'] } = {}
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
  const digest = inboxDigest(card)
  const at = deps.now()
  const mine = deps.store.inbox.list({ automationId: origin.automationId })
  const open = mine.find((i) => WAITING.includes(i.status) && sameCard(i, card, origin))
  if (open) {
    return updateOpen(deps, open, card, digest, at)
  }
  if (card.action && mine.some((i) => skippedBefore(i, card, origin))) {
    return { id: null, existing: false, refused: SKIPPED_BEFORE }
  }
  const { person, routed } = resolveInboxPerson(def.inbox, origin.fields, deps.people())
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
    vaultRef: null
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
