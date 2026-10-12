import type { AutomationDefinition } from '../../shared/definition/types'
import type { InboxItemRow, InboxStatus } from '../../shared/api-types'
import type { InboxListPayload } from '../../shared/inbox-types'
import type { PeopleDirectory } from '../../shared/people'
import type { ActionCatalog } from '../actions/types'
import type { PilotStore } from '../store/store'
import { cardOf, inboxDigest, oneLine } from './card'
import { actionRunLine, type UsageLookup } from './run-line'

export type InboxDeps = {
  store: PilotStore
  now(): number
  definitions(): AutomationDefinition[]
  people(): PeopleDirectory
  newId?(): string
  // Set with the action catalog (Task 22b): an add naming an unknown action, or args that don't fit the
  // action's schema (the problem, else null), is refused.
  knownAction?(name: string): boolean
  actionArgsProblem?(name: string, args: Record<string, unknown>): string | null
  // Called after a card closes (Task 25 cancels an ask-first run whose card closed without starting it).
  onResolved?(item: InboxItemRow): void
}

// The one builder of InboxDeps (the tick's asks, the answers pass, the RPC methods): adds are checked
// against the action catalog. What a closed card does is each caller's explicit choice (null: nothing).
export function buildInboxDeps(src: {
  store: PilotStore
  now(): number
  definitions(): AutomationDefinition[]
  people(): PeopleDirectory
  actions: ActionCatalog
  onResolved: ((item: InboxItemRow) => void) | null
}): InboxDeps {
  const { actions, onResolved } = src
  return {
    store: src.store,
    now: src.now,
    definitions: src.definitions,
    people: src.people,
    knownAction: (name) => actions.get(name) !== null,
    actionArgsProblem: (name, args) => actions.get(name)?.checkArgs(args) ?? null,
    ...(onResolved ? { onResolved } : {})
  }
}

// A card still waiting on its person, or answered and not yet applied.
export const WAITING: readonly InboxStatus[] = ['open', 'answered']
export type ClosedStatus = Exclude<InboxStatus, 'open' | 'answered'>

export function inboxEvent(
  store: PilotStore,
  item: Pick<InboxItemRow, 'id' | 'automationId' | 'runId' | 'worktreePath' | 'itemKey'>,
  kind: string,
  payload: Record<string, unknown>,
  at: number
): void {
  store.events.add({
    at,
    automationId: item.automationId,
    runId: item.runId,
    worktreePath: item.worktreePath,
    itemKey: item.itemKey,
    kind,
    payload: { id: item.id, ...payload }
  })
}

export function getInboxItem(deps: InboxDeps, id: string): InboxItemRow {
  const item = deps.store.inbox.get(id)
  if (!item) {
    throw new Error(`No inbox item ${id}`)
  }
  return item
}

function waitingItem(deps: InboxDeps, id: string): InboxItemRow {
  const item = getInboxItem(deps, id)
  if (!WAITING.includes(item.status)) {
    throw new Error(`Inbox item ${id} is already ${item.status}`)
  }
  return item
}

// A card addressed to a group shows for each of its members.
export function personSees(item: InboxItemRow, person: string, people: PeopleDirectory): boolean {
  if (item.person === person) {
    return true
  }
  return people.groups.some((g) => g.id === item.person && g.members.includes(person))
}

// Each action card's Run line (run-line.ts), keyed by card id: from the stored action and args.
function runLines(items: InboxItemRow[], catalog: UsageLookup | null): Record<string, string> {
  const lines: Record<string, string> = {}
  for (const item of items) {
    if (item.action) {
      const usage = catalog?.get(item.action)?.usage ?? null
      lines[item.id] = actionRunLine(item.action, item.actionArgs ?? {}, usage)
    }
  }
  return lines
}

export function listInbox(
  deps: InboxDeps,
  filter: { person?: string; statuses?: readonly InboxStatus[] },
  catalog: UsageLookup | null = null
): InboxListPayload {
  const people = deps.people()
  const person = filter.person
  const items = deps.store.inbox
    .list({ status: filter.statuses ?? WAITING })
    .filter((i) => !person || personSees(i, person, people))
  return {
    items,
    runLines: runLines(items, catalog),
    people: people.people.map((p) => ({ id: p.id, name: p.name })),
    groups: people.groups.map((g) => ({ id: g.id, name: g.name, members: [...g.members] })),
    automations: deps.definitions().map((d) => ({ id: d.id, name: d.name }))
  }
}

// A vault tick starts its outcome with the status it closes the card as ("obsolete: !1561 merged").
export function statusForOutcome(outcome: string): ClosedStatus {
  if (outcome.startsWith('obsolete')) {
    return 'obsolete'
  }
  if (outcome.startsWith('stale')) {
    return 'stale'
  }
  return 'done'
}

// A finished run with an open card waits on its person (needs_you); once none is open it is done again.
export function syncRunWaiting(store: PilotStore, runId: string | null, at: number): void {
  if (!runId) {
    return
  }
  const run = store.runs.get(runId)
  if (!run) {
    return
  }
  const open = store.inbox.openCountForRun(runId)
  if (run.status === 'done' && open > 0) {
    store.runs.update(runId, { status: 'needs_you' })
  }
  if (run.status === 'needs_you' && open === 0) {
    store.runs.update(runId, { status: 'done', finishedAt: run.finishedAt ?? at })
  }
}

export function resolveInboxItem(
  deps: InboxDeps,
  id: string,
  outcome: string,
  status: ClosedStatus = statusForOutcome(outcome)
): InboxItemRow {
  const item = waitingItem(deps, id)
  const at = deps.now()
  const text = oneLine(outcome)
  deps.store.inbox.update(id, { status, outcome: text }, at)
  deps.store.queue.removePending(id)
  const closed: InboxItemRow = { ...item, status, outcome: text, updatedAt: at }
  inboxEvent(deps.store, closed, 'item_ticked', { status, outcome: text }, at)
  syncRunWaiting(deps.store, item.runId, at)
  deps.onResolved?.(closed)
  return closed
}

// An agent's question about an answer (vault `Reply:`): the card waits on its person again. The last
// answer stays on the card for reference; nothing is dispatched until a new one is saved.
export function replyToInboxItem(deps: InboxDeps, id: string, text: string): InboxItemRow {
  const item = waitingItem(deps, id)
  const reply = oneLine(text)
  if (!reply) {
    throw new Error('A reply needs text')
  }
  const at = deps.now()
  const patch = { replies: [...item.replies, reply], status: 'open' as const }
  deps.store.inbox.update(id, patch, at)
  deps.store.queue.removePending(id)
  inboxEvent(deps.store, item, 'item_replied', { text: reply }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...patch, updatedAt: at }
}

// The dispatcher refused an approval (not saved on the page, or the card changed): clear it and say why.
export function reaskInboxItem(deps: InboxDeps, id: string, reply: string): InboxItemRow {
  const item = waitingItem(deps, id)
  const at = deps.now()
  const patch = {
    status: 'open' as const,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [...item.replies, oneLine(reply)]
  }
  deps.store.inbox.update(id, patch, at)
  deps.store.queue.removePending(id)
  inboxEvent(deps.store, item, 'item_reasked', { reason: oneLine(reply) }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...patch, updatedAt: at }
}

// A stale approved action whose script pins it again (act.py refresh): the same card, a new version
// pinned to the new state, waiting on its person again (apply.py _ask_again).
export function reviseInboxItem(
  deps: InboxDeps,
  id: string,
  change: { actionArgs: Record<string, unknown>; context: string }
): InboxItemRow {
  const item = waitingItem(deps, id)
  const at = deps.now()
  const card = { ...cardOf(item), actionArgs: change.actionArgs, context: oneLine(change.context) }
  const digest = inboxDigest(card)
  const reopened = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
  deps.store.transaction(() => {
    deps.store.inbox.edit(id, { context: card.context, actionArgs: card.actionArgs, digest }, at)
    deps.store.inbox.update(id, reopened, at)
  })
  deps.store.queue.removePending(id)
  inboxEvent(deps.store, item, 'item_updated', { version: item.version + 1, reason: 'refresh' }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...card, digest, version: item.version + 1, ...reopened, updatedAt: at }
}
