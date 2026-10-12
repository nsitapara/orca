import type { ScopeResult, TickItem } from '../api-types'
import type { MergeRequestWhere, PeopleRef } from '../definition/types'
import {
  describeRef,
  EMPTY_PEOPLE,
  matchRefAny,
  personByGitlab,
  refIncludes,
  type PeopleDirectory
} from '../people'
import { IN_SCOPE, firstFailure, listOf, notDue, outOfScope, textOf } from './scope-helpers'

export { IN_SCOPE }

// anyone/absent: no lookup. A people or group ref needs the author in people.yaml. A `not` ref leaves
// out only the people it names, so an author people.yaml doesn't know stays in scope.
export function authorScope(
  ref: PeopleRef | undefined,
  username: string,
  people: PeopleDirectory
): ScopeResult {
  if (ref === undefined || ref === 'anyone') {
    return IN_SCOPE
  }
  const person = personByGitlab(people, username)
  if ('not' in ref) {
    if (!person || refIncludes(ref, person.id, people)) {
      return IN_SCOPE
    }
    return outOfScope(
      `Author is ${person.name}; this automation leaves out ${describeRef(ref.not, people)}`
    )
  }
  if (!person) {
    return outOfScope(`Author ${username} isn't in people.yaml`)
  }
  if (refIncludes(ref, person.id, people)) {
    return IN_SCOPE
  }
  return outOfScope(
    `Author is ${person.name}; this automation looks at ${describeRef(ref, people)}`
  )
}

function stateScope(item: TickItem, where: MergeRequestWhere): ScopeResult {
  const state = item.fields['mr.state']
  if (where.state !== 'open' || state === 'open') {
    return IN_SCOPE
  }
  return outOfScope(`MR is ${textOf(state) ?? '(state unknown)'}`)
}

function reviewerScope(
  item: TickItem,
  where: MergeRequestWhere,
  people: PeopleDirectory
): ScopeResult {
  const match = matchRefAny(
    where.reviewer,
    'Reviewers',
    'gitlab',
    listOf(item.fields['mr.reviewers']),
    people
  )
  return match.ok ? IN_SCOPE : outOfScope(match.reason)
}

function draftScope(item: TickItem, where: MergeRequestWhere): ScopeResult {
  if (where.draft === undefined || item.fields['mr.draft'] === where.draft) {
    return IN_SCOPE
  }
  return outOfScope(where.draft ? "MR isn't a draft" : 'MR is a draft')
}

function targetScope(item: TickItem, where: MergeRequestWhere): ScopeResult {
  const target = item.fields['mr.target_branch']
  if (where.target_branch === undefined || target === where.target_branch) {
    return IN_SCOPE
  }
  return outOfScope(`MR targets ${textOf(target) ?? '(unknown)'}, not ${where.target_branch}`)
}

// 09's rule: anybody's approval rules a review out, even after a later push ("approved by …").
function approvedScope(
  item: TickItem,
  where: MergeRequestWhere,
  people: PeopleDirectory
): ScopeResult {
  if (where.approved_by === undefined) {
    return IN_SCOPE
  }
  const raw = item.fields['mr.approved_by']
  if (typeof raw !== 'string') {
    return outOfScope("Approvals couldn't be read")
  }
  const approvers = listOf(raw)
  if (where.approved_by === 'none') {
    return approvers.length === 0 ? IN_SCOPE : outOfScope(`Approved by ${approvers.join(', ')}`)
  }
  const match = matchRefAny(where.approved_by, 'Approved by', 'gitlab', approvers, people)
  return match.ok ? IN_SCOPE : outOfScope(match.reason)
}

// 05's due gate: a head pipeline that isn't failed (yet) is "not due", not out of scope.
function pipelineDue(item: TickItem, where: MergeRequestWhere): ScopeResult {
  const status = item.fields['mr.pipeline_status']
  if (where.head_pipeline !== 'failed' || status === 'failed') {
    return IN_SCOPE
  }
  return notDue(`Head pipeline ${textOf(status) ?? 'missing'}`)
}

// The clauses the list response alone decides: list() reads no details for an MR they rule out.
export function mergeRequestListScope(
  item: TickItem,
  where: MergeRequestWhere,
  people: PeopleDirectory | null
): ScopeResult {
  const dir = people ?? EMPTY_PEOPLE
  return firstFailure([
    () => stateScope(item, where),
    () => authorScope(where.author, String(item.fields['mr.author'] ?? '(unknown)'), dir),
    () => reviewerScope(item, where, dir),
    () => draftScope(item, where),
    () => targetScope(item, where)
  ])
}

// merge_request where clauses (contract §3): state, author, reviewer, draft, target_branch,
// approved_by, then the due gate. Out of scope always wins over not due.
export function mergeRequestScope(
  item: TickItem,
  where: MergeRequestWhere,
  people: PeopleDirectory | null
): ScopeResult {
  const dir = people ?? EMPTY_PEOPLE
  return firstFailure([
    () => mergeRequestListScope(item, where, people),
    () => approvedScope(item, where, dir),
    () => pipelineDue(item, where)
  ])
}
