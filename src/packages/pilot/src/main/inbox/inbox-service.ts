import type { AutomationDefinition } from '../../shared/definition/types'
import type { InboxItemRow, InboxListRow, InboxStatus } from '../../shared/api-types'
import type { AnswerState, InboxListPayload, RunLine } from '../../shared/inbox-types'
import type { PeopleDirectory } from '../../shared/people'
import { needsEvidence } from '../../shared/evidence'
import { preparationRef } from '../../shared/preparation'
import type { ActionCatalog } from '../actions/types'
import type { PilotStore } from '../store/store'
import { answerLocked, lockedBy, ownsLiveAnswer } from './answer-lock'
import { cardHistories } from './card-history'
import { cardRuns } from './card-runs'
import { oneLine } from './card'

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
  // The Automations folder a card's Details bundle must live in (env.ts pilotDetailsRoot); null or
  // absent refuses every bundle.
  detailsRoot?: string | null
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
  detailsRoot?: string | null
}): InboxDeps {
  const { actions, onResolved } = src
  return {
    store: src.store,
    now: src.now,
    definitions: src.definitions,
    people: src.people,
    knownAction: (name) => actions.get(name) !== null,
    actionArgsProblem: (name, args) => actions.get(name)?.checkArgs(args) ?? null,
    detailsRoot: src.detailsRoot ?? null,
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

// One card whose Run line can't be built is listed without it (logged once per list), never emptying the list.
function runLinesOf(
  items: InboxItemRow[],
  runLineOf: (item: InboxItemRow) => RunLine | null
): Record<string, RunLine> {
  const lines: Record<string, RunLine> = {}
  const failed: string[] = []
  for (const item of items) {
    try {
      const line = runLineOf(item)
      if (line) {
        lines[item.id] = line
      }
    } catch (error) {
      failed.push(`${item.id} (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  if (failed.length > 0) {
    console.warn(`[pilot] couldn't build the Run line of ${failed.join(', ')}`)
  }
  return lines
}

// Each answered card's lock and queue row, in one query.
function answerStatesOf(deps: InboxDeps, items: InboxItemRow[]): Record<string, AnswerState> {
  const answered = items.filter((i) => i.status === 'answered')
  const all = deps.store.queue.forItems(answered.map((i) => i.id))
  const runIds = [...all.values()].flatMap((rows) =>
    rows.flatMap((r) => (r.dispatchedRunId ? [r.dispatchedRunId] : []))
  )
  const live = deps.store.runs.liveAmong(runIds)
  const at = deps.now()
  const states: Record<string, AnswerState> = {}
  for (const item of answered) {
    const rows = all.get(item.id) ?? []
    const row = rows.at(-1) ?? null
    states[item.id] = {
      locked: lockedBy(rows, live, at),
      sentBeforePilot: row?.state === 'dispatched' && row.dispatchedRunId === null,
      state: row?.state ?? null,
      readyAt: row?.readyAt ?? null,
      reason: row?.holdDetail ?? null
    }
  }
  return states
}

// A card as the list carries it (Ruling 2): its preparation as a light ref, its Details without the manifest.
function listRow(item: InboxItemRow): InboxListRow {
  const { preparation, details, ...rest } = item
  const row: InboxListRow = {
    ...rest,
    details: details ? withoutManifest(details) : null,
    needsEvidence: !preparation && needsEvidence(item)
  }
  if (preparation !== undefined) {
    row.preparation = preparation ? preparationRef(preparation) : null
  }
  return row
}

function withoutManifest(details: NonNullable<InboxItemRow['details']>) {
  const { artifacts: _manifest, ...ref } = details
  return ref
}

export function listInbox(
  deps: InboxDeps,
  filter: { person?: string; statuses?: readonly InboxStatus[] },
  // An action card's Run line (inbox/run-line.ts cardRunLine), or null.
  runLineOf: (item: InboxItemRow) => RunLine | null = () => null
): InboxListPayload {
  const people = deps.people()
  const person = filter.person
  deps.store.inbox.fillSummaries()
  const listed = deps.store.inbox
    .list({ status: filter.statuses ?? WAITING })
    .filter((i) => !person || personSees(i, person, people))
  const labels = deps.store.inbox.itemLabels(listed)
  const items = listed.map((i) => {
    const label = labels.get(i.id) ?? (i.itemKey?.startsWith('mr:') ? i.details?.subject : '')
    return label ? { ...i, itemLabel: label } : i
  })
  return {
    items: items.map(listRow),
    runLines: runLinesOf(items, runLineOf),
    answerStates: answerStatesOf(deps, items),
    runs: cardRuns(deps.store, items),
    history: cardHistories(deps.store, items),
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
    // runEnd wrote "Inbox: N open items" while cards were open; with none left the run reads as done.
    const outcome = run.outcome?.startsWith('Inbox: ') ? 'Done' : run.outcome
    store.runs.update(runId, { status: 'done', finishedAt: run.finishedAt ?? at, outcome })
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
//
// While the answer may be being carried out (answerLocked), the reply is only added to the card, and the card
// reopens (and its row goes) just for the live answer run that holds the answer (`ownRunId`, from the call's
// run binding, never its params): anyone else's reply would otherwise get a second answer applied.
export function replyToInboxItem(
  deps: InboxDeps,
  id: string,
  text: string,
  ownRunId: string | null = null
): InboxItemRow {
  const reply = oneLine(text)
  if (!reply) {
    throw new Error('A reply needs text')
  }
  return deps.store.transaction(() => {
    const item = waitingItem(deps, id)
    const at = deps.now()
    const replies = [...item.replies, { text: reply, by: 'agent' as const }]
    const held =
      answerLocked(deps.store, item, at) &&
      !(ownRunId !== null && ownsLiveAnswer(deps.store, item, ownRunId))
    const patch = held ? { replies } : { replies, status: 'open' as const }
    deps.store.inbox.update(id, patch, at)
    if (!held) {
      deps.store.queue.removePending(id)
    }
    inboxEvent(deps.store, item, 'item_replied', { text: reply }, at)
    if (!held) {
      syncRunWaiting(deps.store, item.runId, at)
    }
    return { ...item, ...patch, updatedAt: at }
  })
}

// The dispatcher refused an approval (not saved on the page, or the card changed): clear it and say why.
// Only Pilot's own paths call this (the answers pass), so the line is Pilot's.
export function reaskInboxItem(deps: InboxDeps, id: string, reply: string): InboxItemRow {
  const item = waitingItem(deps, id)
  const at = deps.now()
  const patch = {
    status: 'open' as const,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [...item.replies, { text: oneLine(reply), by: 'pilot' as const }]
  }
  deps.store.inbox.update(id, patch, at)
  deps.store.queue.removePending(id)
  inboxEvent(deps.store, item, 'item_reasked', { reason: oneLine(reply) }, at)
  syncRunWaiting(deps.store, item.runId, at)
  return { ...item, ...patch, updatedAt: at }
}
