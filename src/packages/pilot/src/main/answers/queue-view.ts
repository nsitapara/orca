import { answerWord, APPROVE, routeAnswer, type Route } from '../../shared/answers/route'
import type { InboxAnswer, InboxItemRow } from '../../shared/api-types'
import type { QueueEntry, QueueHow } from '../../shared/inbox-types'
import { personSees, type InboxDeps } from '../inbox/inbox-service'

import { APPROVE_ON_DESKTOP, DRAFT_ON_DESKTOP } from '../../shared/pilot-replies'

export { APPROVE_ON_DESKTOP, DRAFT_ON_DESKTOP }

export type CatalogLookup = { get(name: string): unknown }

// How an answer (text, picked option, and the kind of caller that gave it) is handled. Only the desktop
// approves: a script route for any other caller, or none recorded, is downgraded to a re-ask, so a later
// catalog change can't turn a device's words into a run. An Approve of a drafted change likewise re-asks
// unless it was given on the desktop, where the diff it applies was shown (apply.py DRAFT_PAGE_ONLY).
export function routeFor(
  item: InboxItemRow,
  catalog: CatalogLookup,
  answer: { text: string; option: number | null; callerKind?: InboxAnswer['callerKind'] }
): Route {
  const route = routeAnswer({
    type: item.type,
    action: item.action,
    runnable: item.action !== null && catalog.get(item.action) !== null,
    parts: item.parts,
    text: answer.text,
    option: answer.option
  })
  if (route.kind === 'script' && answer.callerKind !== 'desktop') {
    return { kind: 'reask', reason: APPROVE_ON_DESKTOP }
  }
  const approvesDraft =
    route.kind === 'agent' &&
    !route.revise &&
    item.details?.drafted === true &&
    APPROVE.has(answerWord(answer.text))
  if (approvesDraft && answer.callerKind !== 'desktop') {
    return { kind: 'reask', reason: DRAFT_ON_DESKTOP }
  }
  return route
}

export function routeOf(item: InboxItemRow, catalog: CatalogLookup): Route {
  return routeFor(item, catalog, {
    text: item.answer?.text ?? '',
    option: item.answer?.option ?? null,
    callerKind: item.answer?.callerKind
  })
}

function howOf(route: Route): QueueHow {
  if (route.kind === 'agent') {
    return route.revise ? 'revise' : 'agent'
  }
  return route.kind
}

// What the answer sets off, in plain words (apply.py forecast's `fires`).
function firesOf(item: InboxItemRow, route: Route): string {
  if (route.kind === 'tick') {
    return `Mark it ${route.outcome}`
  }
  if (route.kind === 'reask') {
    return route.reason
  }
  if (route.kind === 'script') {
    if (item.action === 'start_run') {
      return 'Start the run it asked about'
    }
    const without = route.leaveOut.length ? ` without ${route.leaveOut.join(', ')}` : ''
    return `Run ${item.action}${without}; no agent`
  }
  if (route.revise) {
    return 'Its agent revises the card and asks again'
  }
  return item.runId
    ? 'Send your answer to the session that asked'
    : 'Start a new answers session with your answer'
}

export function queueEntries(
  deps: InboxDeps,
  catalog: CatalogLookup,
  filter: { person?: string }
): QueueEntry[] {
  const people = deps.people()
  const names = new Map(deps.definitions().map((d) => [d.id, d.name]))
  const entries: QueueEntry[] = []
  for (const row of deps.store.queue.list(['not_ready', 'ready', 'held'])) {
    const item = deps.store.inbox.get(row.inboxItemId)
    if (!item || (filter.person && !personSees(item, filter.person, people))) {
      continue
    }
    const route = routeOf(item, catalog)
    entries.push({
      rowId: row.id,
      itemId: item.id,
      title: item.title,
      type: item.type,
      automationId: item.automationId,
      automationName: names.get(item.automationId) ?? item.automationId,
      worktreePath: item.worktreePath,
      person: item.person,
      answer: item.answer?.text ?? '',
      state: row.state,
      holdReason: row.holdReason,
      holdDetail: row.holdDetail,
      readyAt: row.readyAt,
      how: howOf(route),
      fires: firesOf(item, route),
      updatedAt: row.updatedAt
    })
  }
  return entries
}
