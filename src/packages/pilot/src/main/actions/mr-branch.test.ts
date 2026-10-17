import { describe, expect, it } from 'vitest'
import { callerStore, DEFINITIONS } from './__fixtures__/caller-store'
import { storeBranchOf, worktreeOn } from './mr-branch'

const WT = '/wt/web-1577'
const NO_CARD = { runId: null, inboxItemId: null }

function setup(present: string[] = []) {
  const s = callerStore()
  const there = new Set(present)
  const deps = {
    store: s.store,
    definitions: () => DEFINITIONS,
    exists: (p: string) => there.has(p)
  }
  return { ...s, deps }
}

describe("an MR's source branch, as Pilot's store knows it", () => {
  it('is the newest item of jobs 03–06 or M02 that names the MR: an MR job’s mr.branch', () => {
    const { deps, tick } = setup()
    tick('fix-failed-ci', 10, [['mr:1577', { 'mr.iid': 1577, 'mr.branch': 'web-1577-old' }]])
    tick('mr-feedback', 20, [['mr:1577', { 'mr.iid': 1577, 'mr.branch': 'web-1577' }]])
    tick('fix-failed-ci', 15, [['mr:1600', { 'mr.iid': 1600, 'mr.branch': 'web-1600' }]])
    expect(storeBranchOf(deps, 1577, NO_CARD)).toBe('web-1577')
  })

  it("is a worktree job's worktree.branch when its item carries the MR, and M02's", () => {
    const wt = setup()
    wt.tick('review-branch-code', 10, [
      ['wt:r::/wt/web-1577', { 'mr.iid': 1577, 'worktree.branch': 'web-1577', 'worktree.path': WT }]
    ])
    expect(storeBranchOf(wt.deps, 1577, NO_CARD)).toBe('web-1577')
    const m02 = setup()
    m02.tick('mr-next-steps', 10, [['mr:1577', { 'mr.iid': 1577, 'mr.branch': 'web-1577' }]])
    expect(storeBranchOf(m02.deps, 1577, NO_CARD)).toBe('web-1577')
  })

  it("is the caller's run's branch when that run names the MR, else unknown", () => {
    const { deps, run } = setup()
    run('m01-run', 'linear-todo', 'linear:WEB-1', WT, {
      'mr.iid': 1577,
      'worktree.branch': 'web-1577'
    })
    expect(storeBranchOf(deps, 1577, { runId: 'm01-run', inboxItemId: null })).toBe('web-1577')
    expect(storeBranchOf(deps, 1600, { runId: 'm01-run', inboxItemId: null })).toBeNull()
    expect(storeBranchOf(deps, 1577, NO_CARD)).toBeNull()
  })
})

describe('the worktree on a branch (mark-ready.py found it by source branch for the unpushed count)', () => {
  it('is a 03/04 worktree whose newest tick puts it on the branch, while its folder is there', () => {
    const { deps, tick } = setup([WT, '/wt/moved'])
    tick('review-branch-code', 10, [
      [
        'wt:r::/wt/web-1577',
        { 'mr.iid': null, 'worktree.branch': 'web-1577', 'worktree.path': WT }
      ],
      ['wt:r::/wt/moved', { 'worktree.branch': 'web-1577', 'worktree.path': '/wt/moved' }]
    ])
    tick('ui-qa-overnight', 20, [
      ['wt:r::/wt/moved', { 'worktree.branch': 'web-1600', 'worktree.path': '/wt/moved' }]
    ])
    expect(worktreeOn(deps, 'web-1577')).toBe(WT)
    expect(worktreeOn(deps, 'web-1600')).toBe('/wt/moved')
    expect(worktreeOn(deps, 'web-9')).toBeNull()
  })

  it('is none once that folder is gone', () => {
    const { deps, tick } = setup([])
    tick('review-branch-code', 10, [
      ['wt:r::/wt/web-1577', { 'worktree.branch': 'web-1577', 'worktree.path': WT }]
    ])
    expect(worktreeOn(deps, 'web-1577')).toBeNull()
  })
})
