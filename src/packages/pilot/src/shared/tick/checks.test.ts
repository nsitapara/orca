import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import type { CheckDef } from '../definition/types'
import { checkName, evaluateCheck } from './checks'

const NOON_LA = Date.UTC(2026, 9, 11, 19, 0) // 12:00 PDT
const run = (c: CheckDef, fields: ItemFields, now = NOON_LA) => {
  const { ok, reason } = evaluateCheck(c, {
    label: '!1561 web-1493',
    fields,
    now,
    timeZone: 'America/Los_Angeles'
  })
  return [ok, reason]
}
type Case = [string, CheckDef, ItemFields, boolean, string]

describe('worktree checks', () => {
  it.each<Case>([
    ['exists', { kind: 'worktree_exists' }, { 'worktree.path': '/wt/a' }, true, '/wt/a'],
    [
      'missing, MR branch named',
      { kind: 'worktree_exists' },
      { 'worktree.path': null, 'mr.branch': 'web-1493-x' },
      false,
      'No worktree for branch web-1493-x'
    ],
    [
      'missing, no branch',
      { kind: 'worktree_exists' },
      { 'worktree.path': null },
      false,
      'No worktree for !1561 web-1493'
    ],
    [
      'an empty path is no worktree',
      { kind: 'worktree_exists' },
      { 'worktree.path': '' },
      false,
      'No worktree for !1561 web-1493'
    ]
  ])('%s', (_name, c, fields, ok, reason) => {
    expect(run(c, fields)).toEqual([ok, reason])
  })
})

describe('session, quota and answers checks', () => {
  it.each<Case>([
    [
      'no session (this automation)',
      { kind: 'session_none_open', scope: 'automation' },
      { 'session.open_from_automation': false },
      true,
      'No session open'
    ],
    [
      'open (this automation)',
      { kind: 'session_none_open', scope: 'automation' },
      { 'session.open_from_automation': true, 'session.open_any': false },
      false,
      'A session from this automation is still open there'
    ],
    [
      'open (any automation)',
      { kind: 'session_none_open', scope: 'any' },
      { 'session.open_from_automation': false, 'session.open_any': true },
      false,
      'A session from an automation is still open there'
    ],
    [
      'unknown',
      { kind: 'session_none_open', scope: 'any' },
      {},
      false,
      "Couldn't tell whether a session is open"
    ],
    [
      'Claude under its limits',
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
      { 'quota.claude.weekly_pct': 61, 'quota.claude.session_pct': 38 },
      true,
      'Claude at 61% weekly, 38% session'
    ],
    [
      'Claude weekly reached',
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
      { 'quota.claude.weekly_pct': 90, 'quota.claude.session_pct': 1 },
      false,
      'Claude is at 90% of its weekly limit (stops at 90%)'
    ],
    [
      'Codex session reached',
      { kind: 'quota', agent: 'codex', weekly: 90, session: 95 },
      { 'quota.codex.weekly_pct': 10, 'quota.codex.session_pct': 97 },
      false,
      'Codex is at 97% of its session limit (stops at 95%)'
    ],
    [
      'Codex unreadable runs (fail-open)',
      { kind: 'quota', agent: 'codex', weekly: 90, session: 95 },
      { 'quota.codex.weekly_pct': null, 'quota.codex.session_pct': null },
      true,
      "Codex quota couldn't be read, so it runs"
    ],
    [
      'nothing pending',
      { kind: 'answers_none_pending' },
      { 'inbox.pending_answers': 0 },
      true,
      'No answers waiting to be applied'
    ],
    [
      'one answer waiting',
      { kind: 'answers_none_pending' },
      { 'inbox.pending_answers': 1 },
      false,
      '1 answer waiting to be applied'
    ],
    [
      'two answers waiting',
      { kind: 'answers_none_pending' },
      { 'inbox.pending_answers': 2 },
      false,
      '2 answers waiting to be applied'
    ],
    [
      'queue unknown',
      { kind: 'answers_none_pending' },
      { 'inbox.pending_answers': null },
      false,
      "Couldn't read this automation's waiting answers"
    ]
  ])('%s', (_name, c, fields, ok, reason) => {
    expect(run(c, fields)).toEqual([ok, reason])
  })
})

describe('merge request checks (gate fields)', () => {
  it.each<Case>([
    [
      'not approved',
      { kind: 'mr', rule: 'not_approved' },
      { 'mr.review_block': '' },
      true,
      'Mine, not merged or closed, and not approved'
    ],
    [
      'approved',
      { kind: 'mr', rule: 'not_approved' },
      { 'mr.review_block': '!1577 approved by alex1craig' },
      false,
      '!1577 approved by alex1craig'
    ],
    [
      'merged',
      { kind: 'mr', rule: 'not_merged' },
      { 'mr.finished_block': '!1453 merged' },
      false,
      '!1453 merged'
    ],
    ['mine', { kind: 'mr', rule: 'mine' }, { 'mr.owner_block': '' }, true, 'Mine (or no MR yet)'],
    [
      "someone else's",
      { kind: 'mr', rule: 'mine' },
      { 'mr.owner_block': "!1588 is shivan2418's MR" },
      false,
      "!1588 is shivan2418's MR"
    ],
    [
      'a draft',
      { kind: 'mr', rule: 'not_draft' },
      { 'mr.draft_block': '!1590 is a draft' },
      false,
      '!1590 is a draft'
    ],
    [
      'no branch facts',
      { kind: 'mr', rule: 'not_draft' },
      {},
      false,
      "Couldn't read the branch's merge requests"
    ]
  ])('%s', (_name, c, fields, ok, reason) => {
    expect(run(c, fields)).toEqual([ok, reason])
  })
})

describe('window, field and script checks', () => {
  const AT_2330_LA = Date.UTC(2026, 9, 12, 6, 30)
  it.each<[string, CheckDef, number, boolean, string]>([
    [
      'outside a night window',
      { kind: 'window', start: '02:00', end: '05:59' },
      NOON_LA,
      false,
      'Outside 02:00-05:59 (now 12:00)'
    ],
    [
      'inside a day window',
      { kind: 'window', start: '11:00', end: '12:00' },
      NOON_LA,
      true,
      'Inside 11:00-12:00 (now 12:00)'
    ],
    [
      'inside a window across midnight',
      { kind: 'window', start: '22:00', end: '06:00' },
      AT_2330_LA,
      true,
      'Inside 22:00-06:00 (now 23:30)'
    ],
    [
      'outside a window across midnight',
      { kind: 'window', start: '22:00', end: '06:00' },
      NOON_LA,
      false,
      'Outside 22:00-06:00 (now 12:00)'
    ]
  ])('%s', (_name, c, now, ok, reason) => {
    expect(run(c, {}, now)).toEqual([ok, reason])
  })

  const field: CheckDef = {
    kind: 'field',
    expr: '{worktree.new_commits} > 0',
    reason: 'No new commits since the last review'
  }
  it.each<[string, ItemFields, boolean, string]>([
    ['holds', { 'worktree.new_commits': 3 }, true, '{worktree.new_commits} > 0 holds'],
    ["doesn't hold", { 'worktree.new_commits': 0 }, false, 'No new commits since the last review'],
    ['field missing', {}, false, 'No new commits since the last review']
  ])('field: %s', (_name, fields, ok, reason) => {
    expect(run(field, fields)).toEqual([ok, reason])
  })

  it('reports an expression that does not parse', () => {
    const [ok, reason] = run({ kind: 'field', expr: '{a} >', reason: 'x' }, {})
    expect(ok).toBe(false)
    expect(reason).toMatch(/^Invalid expression "\{a\} >": /)
  })

  it("uses the script check's precomputed result, and fails one that didn't run", () => {
    const script: CheckDef = {
      kind: 'script',
      run: './scripts/memo-gate.sh --quiet',
      timeoutMs: 60_000
    }
    const ctx = { label: 'x', fields: {}, now: NOON_LA, timeZone: 'America/Los_Angeles' }
    expect(evaluateCheck(script, ctx, { ok: false, reason: 'No memo to remove' })).toEqual({
      check: 'Check memo-gate.sh',
      ok: false,
      reason: 'No memo to remove'
    })
    expect(evaluateCheck(script, ctx).reason).toBe("The check script didn't run")
  })
})

describe('checkName', () => {
  it.each<[CheckDef, string]>([
    [{ kind: 'worktree_exists' }, 'Worktree'],
    [{ kind: 'session_none_open', scope: 'automation' }, 'No open session'],
    [{ kind: 'session_none_open', scope: 'any' }, 'No open session (any)'],
    [{ kind: 'quota', agent: 'claude', weekly: 90, session: 95 }, 'Quota'],
    [{ kind: 'quota', agent: 'codex', weekly: 90, session: 95 }, 'Codex quota'],
    [{ kind: 'mr', rule: 'not_approved' }, 'Not approved'],
    [{ kind: 'window', start: '02:00', end: '05:59' }, 'Window 02:00-05:59'],
    [{ kind: 'answers_none_pending' }, 'No pending answers'],
    [{ kind: 'field', expr: '{x} > 0', reason: 'r' }, '{x} > 0'],
    [{ kind: 'script', run: '/abs/check.sh a b', timeoutMs: 1 }, 'Check check.sh']
  ])('%j → %s', (c, name) => {
    expect(checkName(c)).toBe(name)
  })
})
