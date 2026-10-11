import type { ScopeResult, TickItem } from '../api-types'
import type { MergeRequestWhere, PeopleRef } from '../definition/types'
import {
  describeRef,
  EMPTY_PEOPLE,
  personByGitlab,
  refIncludes,
  type PeopleDirectory
} from '../people'

export const IN_SCOPE: ScopeResult = { ok: true }

function outOfScope(reason: string): ScopeResult {
  return { ok: false, verdict: 'out_of_scope', reason }
}

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

// Clauses whose data the MR source doesn't read until Task 14: the item is left out rather than the
// clause ignored, which would widen what runs.
const NOT_READ_YET: [keyof MergeRequestWhere, string][] = [
  ['reviewer', 'reviewers'],
  ['approved_by', 'approvals'],
  ['target_branch', 'target branches']
]

// merge_request where clauses (contract §3), in M1's order: state, author, then the due gate.
export function mergeRequestScope(
  item: TickItem,
  where: MergeRequestWhere,
  people: PeopleDirectory | null
): ScopeResult {
  const state = item.fields['mr.state']
  if (where.state === 'open' && state !== 'open') {
    return outOfScope(`MR is ${state ?? '(state unknown)'}`)
  }
  const username = String(item.fields['mr.author'] ?? '(unknown)')
  const author = authorScope(where.author, username, people ?? EMPTY_PEOPLE)
  if (!author.ok) {
    return author
  }
  if (where.draft !== undefined && item.fields['mr.draft'] !== where.draft) {
    return outOfScope(where.draft ? "MR isn't a draft" : 'MR is a draft')
  }
  for (const [clause, data] of NOT_READ_YET) {
    if (where[clause] !== undefined) {
      return outOfScope(`Pilot doesn't read MR ${data} yet, so where.${clause} can't be checked`)
    }
  }
  const status = item.fields['mr.pipeline_status']
  if (where.head_pipeline === 'failed' && status !== 'failed') {
    return { ok: false, verdict: 'notdue', reason: `Head pipeline ${status ?? 'missing'}` }
  }
  return IN_SCOPE
}
