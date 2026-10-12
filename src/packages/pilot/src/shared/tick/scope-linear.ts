import type { ItemFields, ScopeResult } from '../api-types'
import type { LinearTicketWhere } from '../definition/types'
import { matchRef, personByLinear, type PeopleDirectory } from '../people'
import { IN_SCOPE, firstFailure, outOfScope, textOf } from './scope-helpers'

// No assignee clause: the signed-in user's tickets (M01's `--filter assigned`). `anyone`: every ticket.
export function linearListFilter(w: LinearTicketWhere): 'assigned' | 'all' {
  return w.assignee === 'anyone' ? 'all' : 'assigned'
}

export function stateTypeAllowed(type: string | null | undefined, w: LinearTicketWhere): boolean {
  return (
    w.state_type === undefined ||
    (type !== null && type !== undefined && w.state_type.includes(type))
  )
}

// linear-todo-sweep order_key: urgent (1) first, no priority (0) after low (4), then oldest first.
const NO_PRIORITY = 5
export function ticketPriority(priority: number | null | undefined): number {
  return priority || NO_PRIORITY
}

export function compareTickets(
  a: { priority?: number | null; createdAt?: string | null },
  b: { priority?: number | null; createdAt?: string | null }
): number {
  const byPriority = ticketPriority(a.priority) - ticketPriority(b.priority)
  if (byPriority !== 0) {
    return byPriority
  }
  const ac = a.createdAt ?? ''
  const bc = b.createdAt ?? ''
  if (ac === bc) {
    return 0
  }
  return ac < bc ? -1 : 1
}

// people.yaml's `linear` holds a display name or a Linear user id; try both.
function assigneeHandle(f: ItemFields, people: PeopleDirectory): string | null {
  const name = textOf(f['ticket.assignee'])
  const id = textOf(f['ticket.assignee_id'])
  if (id && !(name && personByLinear(people, name)) && personByLinear(people, id)) {
    return id
  }
  return name
}

function stateScope(f: ItemFields, w: LinearTicketWhere): ScopeResult {
  if (stateTypeAllowed(textOf(f['ticket.state_type']), w)) {
    return IN_SCOPE
  }
  const state = textOf(f['ticket.state']) ?? '(unknown)'
  return outOfScope(`State is ${state} (${textOf(f['ticket.state_type']) ?? 'unknown'})`)
}

function teamScope(f: ItemFields, w: LinearTicketWhere): ScopeResult {
  if (w.team === undefined) {
    return IN_SCOPE
  }
  const wanted = w.team.toLowerCase()
  const key = textOf(f['ticket.team'])
  const name = textOf(f['ticket.team_name'])
  if (key?.toLowerCase() === wanted || name?.toLowerCase() === wanted) {
    return IN_SCOPE
  }
  return outOfScope(`Team is ${key ?? name ?? '(none)'}`)
}

function branchScope(f: ItemFields, w: LinearTicketWhere): ScopeResult {
  const branch = textOf(f['ticket.branch'])
  if (w.has_branch === undefined || (branch !== null) === w.has_branch) {
    return IN_SCOPE
  }
  return outOfScope(branch === null ? 'No branch name in Linear' : `Has branch ${branch}`)
}

export function linearTicketScope(
  f: ItemFields,
  w: LinearTicketWhere,
  people: PeopleDirectory
): ScopeResult {
  return firstFailure([
    () => {
      const match = matchRef(w.assignee, 'Assignee', 'linear', assigneeHandle(f, people), people)
      return match.ok ? IN_SCOPE : outOfScope(match.reason)
    },
    () => stateScope(f, w),
    () => teamScope(f, w),
    () => branchScope(f, w)
  ])
}
