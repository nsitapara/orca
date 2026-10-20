import type { ItemFields, ScopeResult } from '../api-types'
import type { WorktreeCommits, WorktreeWhere } from '../definition/types'
import { matchRef, type PeopleDirectory } from '../people'
import { IN_SCOPE, firstFailure, numberOf, outOfScope, textOf } from './scope-helpers'

// 04's rule (ui-qa due.py): a first sight is tested when its newest own commit is under 7 days old.
export const TEST_RECENT_MS = 7 * 86_400_000

export function firstSightMode(commits: WorktreeCommits | undefined): 'baseline' | 'test_recent' {
  return commits?.first_sight ?? 'baseline'
}

// 03 (`baseline`): every first sight is recorded, never reviewed (gate.evaluate). 04 (`test_recent`):
// a first sight is tested when its newest own commit is recent, else recorded (due.decide).
export function firstSightBaseline(
  commits: WorktreeCommits,
  facts: { firstSight: boolean; newCommits: number; newestCommitAt: number | null },
  now: number
): boolean {
  if (!facts.firstSight) {
    return false
  }
  if (
    firstSightMode(commits) === 'baseline' ||
    facts.newCommits === 0 ||
    facts.newestCommitAt === null
  ) {
    return true
  }
  return now - facts.newestCommitAt > TEST_RECENT_MS
}

function lookupError(f: ItemFields): string | null {
  return textOf(f['mr.lookup_error'])
}

// gate.owner_block through people.yaml: a teammate's open MR makes the branch theirs; no MR yet
// counts as the automation's own; GitLab not saying blocks.
function ownerScope(f: ItemFields, w: WorktreeWhere, people: PeopleDirectory): ScopeResult {
  if (w.branch_owner === undefined || w.branch_owner === 'anyone') {
    return IN_SCOPE
  }
  const error = lookupError(f)
  if (error) {
    return outOfScope(`MR owner unknown: ${error}`)
  }
  const iid = numberOf(f['mr.iid'])
  if (iid === null) {
    return IN_SCOPE
  }
  const author = textOf(f['mr.author'])
  if (!author) {
    return outOfScope(`MR owner unknown: GitLab didn't name !${iid}'s author`)
  }
  const match = matchRef(w.branch_owner, 'Owner', 'gitlab', author, people)
  return match.ok ? IN_SCOPE : outOfScope(`!${iid} is ${author}'s MR`)
}

function hasMrScope(f: ItemFields, w: WorktreeWhere): ScopeResult {
  if (w.has_mr === undefined) {
    return IN_SCOPE
  }
  const error = lookupError(f)
  if (error) {
    return outOfScope(`MR state unknown: ${error}`)
  }
  const iid = numberOf(f['mr.iid'])
  if ((iid !== null) === w.has_mr) {
    return IN_SCOPE
  }
  return outOfScope(iid === null ? 'No merge request yet' : `Has !${iid}`)
}

function mrScope(f: ItemFields, w: WorktreeWhere, people: PeopleDirectory): ScopeResult {
  if (w.mr_author === undefined && w.mr_state === undefined) {
    return IN_SCOPE
  }
  const error = lookupError(f)
  if (error) {
    return outOfScope(`MR state unknown: ${error}`)
  }
  const iid = numberOf(f['mr.iid'])
  if (iid === null) {
    return outOfScope('No merge request yet')
  }
  if (w.mr_state === 'open' && f['mr.state'] !== 'open') {
    return outOfScope(`!${iid} is ${textOf(f['mr.state']) ?? 'in an unknown state'}`)
  }
  const match = matchRef(w.mr_author, 'MR author', 'gitlab', textOf(f['mr.author']), people)
  return match.ok ? IN_SCOPE : outOfScope(match.reason)
}

// gate.evaluate: a branch with no own commit since its marker isn't listed; a first sight always is
// (to be baselined, or tested in 04).
function commitsScope(f: ItemFields, w: WorktreeWhere): ScopeResult {
  if (w.commits === undefined) {
    return IN_SCOPE
  }
  const count = numberOf(f['worktree.new_commits'])
  if (count === null) {
    const why = textOf(f['worktree.git_error']) ?? 'unknown error'
    return outOfScope(`Couldn't read the branch's commits: ${why}`)
  }
  if (f['worktree.first_sight'] === true || count > 0) {
    return IN_SCOPE
  }
  const under = w.commits.paths ? ` under ${w.commits.paths.join(', ')}` : ''
  return outOfScope(`Nothing new${under} since ${textOf(f['worktree.since_short']) ?? '(unknown)'}`)
}

export function worktreeScope(
  f: ItemFields,
  w: WorktreeWhere,
  people: PeopleDirectory
): ScopeResult {
  return firstFailure([
    () => ownerScope(f, w, people),
    () => hasMrScope(f, w),
    () => mrScope(f, w, people),
    () => commitsScope(f, w)
  ])
}
