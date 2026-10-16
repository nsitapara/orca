import { describe, expect, it } from 'vitest'
import { callerStore, DEFINITIONS } from './__fixtures__/caller-store'
import { storeBranchOf } from './mr-branch'
import { openCardsOn } from './mr-open-cards'

const WT = '/wt/web-1577'
const BRANCH = 'web-1577'
const ON_MR = { 'mr.iid': 1577, 'worktree.path': WT, 'worktree.branch': BRANCH }
const NO_CARD = { runId: null, inboxItemId: null }

// The cards jobs 03–06 leave on !1577's branch: a worktree job's (its item carries the branch's MR) and an MR job's.
function setup() {
  const s = callerStore()
  s.run('wt-run', 'review-branch-code', 'wt:repo::/wt/web-1577', WT, ON_MR)
  s.run('ci-run', 'fix-failed-ci', 'mr:1577', WT, { 'mr.iid': 1577, 'mr.branch': BRANCH })
  s.run('other-run', 'mr-feedback', 'mr:1600', '/wt/web-1600', {
    'mr.iid': 1600,
    'mr.branch': 'web-1600'
  })
  s.run('other-wt-run', 'review-branch-code', 'wt:repo::/wt/web-1600', '/wt/web-1600', {
    'mr.iid': null,
    'worktree.path': '/wt/web-1600',
    'worktree.branch': 'web-1600'
  })
  s.run('m01-run', 'linear-todo', 'linear:WEB-1', WT, { 'worktree.path': WT })
  s.run('m02-run', 'mr-next-steps', 'mr:1577', WT, { 'mr.iid': 1577 })
  const deps = { store: s.store, definitions: () => DEFINITIONS, exists: () => true }
  return { ...s, deps }
}

describe("the open Pilot cards on an MR's branch (mark-ready.py's open items)", () => {
  it('counts waiting cards from jobs 03–06 on the MR, named by job', () => {
    const { deps, card } = setup()
    card('wt-run')
    card('ci-run')
    card('ci-run', { title: 'Second?' })
    expect(openCardsOn(deps, 1577, BRANCH, NO_CARD)).toBe('3 open items from 03, 05')
  })

  it('counts an answered card that is still waiting to be applied, and one item alone', () => {
    const { deps, store, card } = setup()
    store.inbox.update(card('wt-run'), { status: 'answered' }, 1000)
    expect(openCardsOn(deps, 1577, BRANCH, NO_CARD)).toBe('1 open item from 03')
  })

  // 03 reviews a branch before its MR exists (parity case no-mr-yet): its card names no MR, only the branch. The MR the
  // branch gets later is learned from another job's item, and the card still blocks it.
  it.each<[string, Record<string, unknown>]>([
    ['made before the MR existed', { 'mr.iid': null }],
    ['from a tick whose MR lookup failed', { 'mr.iid': null, 'mr.lookup_error': 'GitLab 502' }],
    ['when another MR owned the branch', { 'mr.iid': 1500 }]
  ])('counts a 03 card on the branch %s', (_name, mr) => {
    const s = callerStore()
    s.run('wt-run', 'review-branch-code', 'wt:repo::/wt/web-1577', WT, {
      'worktree.path': WT,
      'worktree.branch': BRANCH,
      ...mr
    })
    s.tick('fix-failed-ci', 20, [['mr:1577', { 'mr.iid': 1577, 'mr.branch': BRANCH }]])
    s.card('wt-run')
    const deps = { store: s.store, definitions: () => DEFINITIONS, exists: () => true }
    const branch = storeBranchOf(deps, 1577, NO_CARD)
    expect(branch).toBe(BRANCH)
    expect(openCardsOn(deps, 1577, branch!, NO_CARD)).toBe('1 open item from 03')
  })

  it("counts a card whose run has no tick (imported, aged out) by its worktree, which 03's newest tick puts on the branch", () => {
    const s = setup()
    s.bareRun('old-run', 'ui-qa-overnight', 'wt:repo::/wt/web-1577', WT)
    s.card('old-run')
    expect(openCardsOn(s.deps, 1577, BRANCH, NO_CARD)).toBe('1 open item from 04')
  })

  it('counts a card posted outside a run, by its worktree or by an item key under the branch', () => {
    const s = setup()
    s.tick('review-branch-code', 30, [['wt:repo::/wt/web-1577', ON_MR]])
    s.card(null, {
      automationId: 'review-branch-code',
      itemKey: 'wt:repo::/wt/web-1577',
      worktreePath: WT
    })
    expect(openCardsOn(s.deps, 1577, BRANCH, NO_CARD)).toBe('1 open item from 03')
    const keyed = setup()
    keyed.card(null, { automationId: 'mr-feedback', itemKey: `${BRANCH}:thread-9` })
    expect(openCardsOn(keyed.deps, 1577, BRANCH, NO_CARD)).toBe('1 open item from 06')
  })

  it.each<[string, (s: ReturnType<typeof setup>) => void]>([
    ['nothing open', () => {}],
    [
      'a card already done',
      (s) => s.store.inbox.update(s.card('wt-run'), { status: 'done' }, 1000)
    ],
    [
      'a card made obsolete',
      (s) => s.store.inbox.update(s.card('ci-run'), { status: 'obsolete' }, 1000)
    ],
    ['a folded default (work already done)', (s) => s.card('wt-run', { type: 'default' })],
    ['a card on another MR', (s) => s.card('other-run')],
    ['a card on another branch with no MR', (s) => s.card('other-wt-run')],
    ['a card from a job outside 03–06 (M01)', (s) => s.card('m01-run')],
    ['a card from a job outside 03–06 (M02)', (s) => s.card('m02-run')]
  ])('leaves the MR free with %s', (_name, add) => {
    const s = setup()
    add(s)
    expect(openCardsOn(s.deps, 1577, BRANCH, NO_CARD)).toBeNull()
  })

  it('never counts the card being approved', () => {
    const { deps, card } = setup()
    const asking = card('ci-run', {
      type: 'action',
      action: 'mark_ready',
      actionArgs: { argv: ['1577', 'abcdef0'] }
    })
    const caller = { runId: 'ci-run', inboxItemId: asking }
    expect(openCardsOn(deps, 1577, BRANCH, caller)).toBeNull()
    card('wt-run')
    expect(openCardsOn(deps, 1577, BRANCH, caller)).toBe('1 open item from 03')
  })
})
