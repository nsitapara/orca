import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import type { WorktreeCommits } from '../definition/types'
import { worktreeWhereSchema } from '../definition/where'
import type { PeopleDirectory } from '../people'
import { firstSightBaseline, worktreeScope } from './scope-worktree'

const people: PeopleDirectory = {
  people: [
    { id: 'nish', name: 'Nish Sitapara', gitlab: 'nish8' },
    { id: 'alex', name: 'Alex Craig', gitlab: 'alex1craig' }
  ],
  groups: []
}
const base: ItemFields = {
  'mr.iid': 1577,
  'mr.author': 'nish8',
  'mr.state': 'open',
  'mr.lookup_error': null,
  'worktree.new_commits': 2,
  'worktree.first_sight': false,
  'worktree.since_short': 'abc123456',
  'worktree.git_error': null
}
const MINE = { branch_owner: { people: ['nish'] } }
const COMMITS = { commits: { ignore_trailer: 'Agent-Loop: standards' } }

// gate.worktrees' owner rule, gate.evaluate's "no new commits", and the MR clauses.
describe('worktreeScope', () => {
  it.each<[string, Record<string, unknown>, ItemFields, string | null]>([
    ['mine, with new commits', MINE, {}, null],
    [
      "a teammate's MR",
      MINE,
      { 'mr.iid': 1588, 'mr.author': 'shivan2418' },
      "!1588 is shivan2418's MR"
    ],
    ['no MR yet counts as mine', MINE, { 'mr.iid': null, 'mr.author': null }, null],
    ['GitLab failing', MINE, { 'mr.lookup_error': 'glab: 502' }, 'MR owner unknown: glab: 502'],
    [
      'no author named',
      MINE,
      { 'mr.author': null },
      "MR owner unknown: GitLab didn't name !1577's author"
    ],
    ['has_mr wanted, none', { has_mr: true }, { 'mr.iid': null }, 'No merge request yet'],
    ['has_mr: false, has one', { has_mr: false }, {}, 'Has !1577'],
    ['open MRs only', { mr_state: 'open' }, { 'mr.state': 'merged' }, '!1577 is merged'],
    [
      "someone else's MR",
      { mr_author: { people: ['nish'] } },
      { 'mr.author': 'alex1craig' },
      'MR author is Alex Craig; this automation looks at Nish Sitapara'
    ],
    ['nothing new', COMMITS, { 'worktree.new_commits': 0 }, 'Nothing new since abc123456'],
    [
      'nothing new under the paths',
      { commits: { paths: ['apps/', 'api/'] } },
      { 'worktree.new_commits': 0 },
      'Nothing new under apps/, api/ since abc123456'
    ],
    [
      'first sight is always in scope',
      COMMITS,
      { 'worktree.new_commits': 0, 'worktree.first_sight': true },
      null
    ],
    [
      "commits that couldn't be read",
      COMMITS,
      { 'worktree.new_commits': null, 'worktree.git_error': 'fatal: bad object' },
      "Couldn't read the branch's commits: fatal: bad object"
    ],
    ['no commits clause, no commit filter', {}, { 'worktree.new_commits': 0 }, null]
  ])('%s', (_name, where, fields, want) => {
    const got = worktreeScope({ ...base, ...fields }, worktreeWhereSchema.parse(where), people)
    expect(got.ok ? null : got.reason).toBe(want)
  })
})

const DAY = 86_400_000
const NOW = Date.parse('2026-10-11T12:00:00Z')
const R03 = worktreeWhereSchema.parse({ commits: {} }).commits as WorktreeCommits
const R04 = worktreeWhereSchema.parse({ commits: { first_sight: 'test_recent' } })
  .commits as WorktreeCommits

// gate.evaluate (03: every first sight is recorded, never reviewed) and due.decide (04: a first sight
// is tested when its newest own commit is under 7 days old, else recorded).
describe('firstSightBaseline', () => {
  it.each([
    ['03, not first sight', R03, false, 2, NOW - DAY, false],
    ['03, first sight', R03, true, 0, null, true],
    ['04, first sight with recent work', R04, true, 3, NOW - 2 * DAY, false],
    ['04, first sight with old work', R04, true, 3, NOW - 8 * DAY, true],
    ['04, first sight with no own commit', R04, true, 0, null, true]
  ] as [string, WorktreeCommits, boolean, number, number | null, boolean][])(
    '%s',
    (_name, rule, first, count, newest, want) => {
      expect(
        firstSightBaseline(
          rule,
          { firstSight: first, newCommits: count, newestCommitAt: newest },
          NOW
        )
      ).toBe(want)
    }
  )
})
