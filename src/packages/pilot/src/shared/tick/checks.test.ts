import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import type { CheckDef } from '../definition/types'
import { evaluateCheck } from './checks'

const base: ItemFields = {
  'mr.branch': 'b',
  'worktree.path': '/wt/b',
  'worktree.dirty_count': 0,
  'worktree.git_operation': null,
  'session.open_from_automation': false,
  'quota.claude.weekly_pct': 61,
  'quota.claude.session_pct': 38
}
const QUOTA: CheckDef = { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
const CODEX_QUOTA: CheckDef = { kind: 'quota', agent: 'codex', weekly: 80, session: 95 }
const SESSION: CheckDef = { kind: 'session_none_open', scope: 'automation' }

describe('evaluateCheck', () => {
  const cases: [CheckDef, ItemFields, boolean, string][] = [
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
      SESSION,
      { 'session.open_from_automation': true },
      false,
      'A session from this automation is still open there'
    ],
    [
      QUOTA,
      { 'quota.claude.weekly_pct': 92 },
      false,
      'Claude is at 92% of its weekly limit (stops at 90%)'
    ],
    [
      QUOTA,
      { 'quota.claude.weekly_pct': null, 'quota.claude.session_pct': null },
      true,
      "Claude quota couldn't be read, so it runs"
    ],
    [{ kind: 'worktree_exists' }, { 'worktree.path': 5 }, false, 'No worktree for branch b'],
    [
      { kind: 'worktree_clean' },
      { 'worktree.dirty_count': 'x' },
      false,
      "Couldn't read uncommitted changes"
    ],
    [
      { kind: 'worktree_clean' },
      { 'worktree.git_operation': true },
      false,
      "Couldn't tell whether a git operation is in progress"
    ],
    [
      SESSION,
      { 'session.open_from_automation': null },
      false,
      "Couldn't tell whether a session is open"
    ],
    [
      QUOTA,
      { 'quota.claude.weekly_pct': 90 },
      false,
      'Claude is at 90% of its weekly limit (stops at 90%)'
    ],
    [
      QUOTA,
      { 'quota.claude.session_pct': 96 },
      false,
      'Claude is at 96% of its session limit (stops at 95%)'
    ],
    [QUOTA, {}, true, 'Claude at 61% weekly, 38% session'],
    [
      CODEX_QUOTA,
      { 'quota.codex.weekly_pct': 85 },
      false,
      'Codex is at 85% of its weekly limit (stops at 80%)'
    ],
    [CODEX_QUOTA, {}, true, "Codex quota couldn't be read, so it runs"]
  ]
  it.each(cases)('%o with %o', (check, overrides, ok, reason) => {
    expect(evaluateCheck(check, { ...base, ...overrides })).toMatchObject({ ok, reason })
  })

  const missing: [CheckDef, string][] = [
    [{ kind: 'worktree_clean' }, 'worktree.dirty_count'],
    [{ kind: 'worktree_clean' }, 'worktree.git_operation'],
    [SESSION, 'session.open_from_automation'],
    [{ kind: 'worktree_exists' }, 'worktree.path']
  ]
  it.each(missing)('%o fails when %s is missing entirely', (check, key) => {
    const { [key]: _omitted, ...rest } = base
    expect(evaluateCheck(check, rest)).toMatchObject({ ok: false })
  })

  // Task 6 evaluates these. Until then they fail, so nothing starts on a check Pilot can't read.
  const later: [CheckDef, string][] = [
    [{ kind: 'worktree_idle' }, 'Idle'],
    [{ kind: 'session_none_open', scope: 'any' }, 'No open session'],
    [{ kind: 'mr', rule: 'not_approved' }, 'MR'],
    [{ kind: 'window', start: '02:00', end: '05:59' }, 'Window'],
    [{ kind: 'answers_none_pending' }, 'No pending answers'],
    [{ kind: 'field', expr: '{a} > 0', reason: 'r' }, 'Field'],
    [{ kind: 'script', run: './x.sh', timeoutMs: 1000 }, 'Script']
  ]
  it.each(later)('fails %o until Task 6 reads it', (check, name) => {
    expect(evaluateCheck(check, base)).toEqual({
      check: name,
      ok: false,
      reason: `Pilot can't evaluate the ${name} check yet`
    })
  })
})
