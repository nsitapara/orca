import { describe, expect, it } from 'vitest'
import type { PilotContext } from '../pilot-services'
import { buildTimelineMethods } from './methods-timeline'

type Callable = {
  name: string
  permission: string
  params: { safeParse(v: unknown): { success: boolean } }
  handler(p: unknown): unknown
}

function timelineMethod(): Callable {
  const ctx = {
    store: {
      timeline: { nextFor: () => [], openInbox: () => [], inboxForRuns: () => [] },
      runs: { forWorktree: () => [], steps: () => [] },
      usage: { costForWorktreeOn: () => 0 }
    },
    loaded: () => ({ definitions: [] }),
    scheduler: { nextTickAt: () => null }
  } as unknown as PilotContext
  return (buildTimelineMethods(() => ctx) as unknown as Callable[]).find(
    (m) => m.name === 'pilot.worktree.timeline'
  )!
}

describe('pilot.worktree.timeline', () => {
  it('returns the timeline shape for a worktree', () => {
    expect(timelineMethod().handler({ worktreePath: '/wt/a' })).toEqual({
      next: [],
      now: [],
      earlier: [],
      waiting: [],
      spentTodayUsd: 0
    })
  })

  it.each([
    [{ worktreePath: '/wt/a' }, true],
    [{ worktreePath: '/wt/a', person: 'nish' }, true],
    [{ worktreePath: '' }, false],
    [{}, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(timelineMethod().params.safeParse(params).success).toBe(ok)
  })
})
