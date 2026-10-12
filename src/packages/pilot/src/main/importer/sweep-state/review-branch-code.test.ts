import { describe, expect, it } from 'vitest'
import { MAPPERS } from './registry'
import { reviewBranchCodeMapper } from './review-branch-code'
import { stateReader } from './test-reader'

const SHA = 'a'.repeat(40)
const WORKTREES = [
  { id: 'repo::/wt/a', path: '/wt/a', branch: 'web-1-a' },
  { id: 'repo::/wt/b', path: '/wt/b', branch: 'web-2-b' }
]

function reader(state: Record<string, unknown>) {
  return stateReader({
    json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null),
    worktrees: () => WORKTREES,
    now: 9
  })
}

function stopped(path: string, round: number): string {
  return `${path}: its cycle (round ${round}) never completed; Pilot's first cycle there reviews those commits again (the sweep's "stale"); if it is still running, let it finish before 03 is enabled in Pilot`
}

describe('03 state import', () => {
  it("starts each worktree's marker where the sweep's review left off, and marks it seen", () => {
    const plan = reviewBranchCodeMapper.plan(reader({ 'standards/seen.json': { '/wt/a': SHA } }))
    expect(plan.handled).toEqual([
      { onceKey: `repo::/wt/a@${SHA}`, status: 'done', at: 9, failedAt: null }
    ])
    expect(plan.seen).toEqual([{ itemKey: 'wt:repo::/wt/a', at: 9 }])
    expect(plan.notes).toEqual([])
  })

  it.each([
    [
      'a worktree Orca no longer lists',
      { '/wt/gone': SHA },
      "no Orca worktree at /wt/gone; its review marker isn't imported"
    ],
    [
      'a value that is not a sha',
      { '/wt/a': 'HEAD' },
      '/wt/a: "HEAD" isn\'t a commit sha; skipped'
    ],
    ['a file that is not an object', ['/wt/a'], 'standards/seen.json: expected a JSON object']
  ])('reports %s', (_name, seen, note) => {
    const plan = reviewBranchCodeMapper.plan(reader({ 'standards/seen.json': seen }))
    expect(plan.handled).toEqual([])
    expect(plan.notes).toEqual([note])
  })

  it('reports a cycle that never completed: Pilot restarts those commits', () => {
    const state = {
      'standards/seen.json': { '/wt/b': SHA, '/wt/a': 'e'.repeat(40) },
      'standards/cycles.json': {
        '/wt/b': { lead: 'claude', round: 2, base: SHA, head: 'c'.repeat(40) },
        '/wt/a': { lead: 'codex', round: 3, base: 'd'.repeat(40), head: 'e'.repeat(40) },
        '/wt/c': { lead: 'codex', round: 1, base: SHA, head: 'f'.repeat(40) }
      }
    }
    const plan = reviewBranchCodeMapper.plan(reader(state))
    expect(plan.notes).toEqual([stopped('/wt/b', 2), stopped('/wt/c', 1)])
  })

  it('is the registered mapper for review-branch-code', () => {
    expect(MAPPERS.filter((m) => m.automationId === 'review-branch-code')).toEqual([
      reviewBranchCodeMapper
    ])
  })
})
