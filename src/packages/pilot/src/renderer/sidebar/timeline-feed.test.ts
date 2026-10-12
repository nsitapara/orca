// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worktreeTimeline } from '../timeline/timeline.fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import {
  refreshWorktreeTimeline,
  resetTimelineFeeds,
  TIMELINE_POLL_MS,
  useWorktreeTimeline
} from './timeline-feed'

const calls = (): number => pilotRpc.mock.calls.length

describe('useWorktreeTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pilotRpc.mockResolvedValue(worktreeTimeline({ spentTodayUsd: 1 }))
  })
  afterEach(() => {
    resetTimelineFeeds()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  it('loads at once, polls while someone watches, and stops when nobody does', async () => {
    const { result, unmount } = renderHook(() => useWorktreeTimeline('/wt/a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(pilotRpc).toHaveBeenCalledWith('pilot.worktree.timeline', { worktreePath: '/wt/a' })
    expect(result.current.data?.spentTodayUsd).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMELINE_POLL_MS)
    })
    expect(calls()).toBe(2)
    unmount()
    await vi.advanceTimersByTimeAsync(TIMELINE_POLL_MS * 3)
    expect(calls()).toBe(2)
  })

  it('the panel and the badge on one worktree share one poll', async () => {
    renderHook(() => useWorktreeTimeline('/wt/a'))
    renderHook(() => useWorktreeTimeline('/wt/a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(calls()).toBe(1)
  })

  it('keeps the last timeline when a poll fails, and shows the error', async () => {
    const { result } = renderHook(() => useWorktreeTimeline('/wt/a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    pilotRpc.mockRejectedValueOnce(new Error("Pilot isn't running"))
    await act(async () => {
      refreshWorktreeTimeline('/wt/a')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toMatchObject({
      data: { spentTodayUsd: 1 },
      error: "Pilot isn't running"
    })
  })

  it('asks nothing without a worktree', async () => {
    const { result } = renderHook(() => useWorktreeTimeline(null))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMELINE_POLL_MS)
    })
    expect(calls()).toBe(0)
    expect(result.current).toEqual({ data: null, error: null })
  })
})
