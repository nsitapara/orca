import { describe, expect, it } from 'vitest'
import { evaluateCheck } from './checks'

const base = {
  'mr.branch': 'b',
  'worktree.path': '/wt/b',
  'worktree.dirty_count': 0,
  'worktree.git_operation': null,
  'session.open_from_automation': false,
  'quota.claude.weekly_pct': 61,
  'quota.claude.session_pct': 38
}

describe('evaluateCheck', () => {
  it.each([
    [{ kind: 'worktree_exists' }, { 'worktree.path': null }, false, 'No worktree for branch b'],
    [{ kind: 'worktree_clean' }, { 'worktree.dirty_count': 2 }, false, '2 uncommitted files'],
    [{ kind: 'worktree_clean' }, { 'worktree.dirty_count': 1 }, false, '1 uncommitted file'],
    [
      { kind: 'worktree_clean' },
      { 'worktree.git_operation': 'rebase' },
      false,
      'A rebase is in progress'
    ],
    [
      { kind: 'session_none_open' },
      { 'session.open_from_automation': true },
      false,
      'A session from this automation is still open there'
    ],
    [
      { kind: 'quota', weekly: 90, session: 95 },
      { 'quota.claude.weekly_pct': 92 },
      false,
      'Claude is at 92% of its weekly limit (stops at 90%)'
    ],
    [
      { kind: 'quota', weekly: 90, session: 95 },
      { 'quota.claude.weekly_pct': null, 'quota.claude.session_pct': null },
      true,
      "Claude quota couldn't be read, so it runs"
    ],
    [{ kind: 'quota', weekly: 90, session: 95 }, {}, true, 'Claude at 61% weekly, 38% session']
  ] as const)('%o with %o', (check, overrides, ok, reason) => {
    expect(evaluateCheck(check, { ...base, ...overrides })).toMatchObject({ ok, reason })
  })
})
