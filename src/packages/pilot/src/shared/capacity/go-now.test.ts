import { describe, expect, it } from 'vitest'
import type { HoldReason } from '../api-types'
import { canGoNow, GO_NOW_SKIPS } from './go-now'

// Every code a waiting item can carry, and whether Go now shows on it. A Record, so a new code must say.
const SHOWS: Record<HoldReason, boolean> = {
  retry: true,
  quota: true,
  job_limit: true,
  tick_limit: true,
  capacity: true,
  window: true,
  worktree_busy: false,
  own_run: false,
  in_flight: false,
  claimed: false,
  typing: false,
  session_open: false,
  answers_pending: false,
  no_worktree: false,
  mr_unknown: false,
  waits: false
}
const CODES = Object.keys(SHOWS).filter((key): key is HoldReason => Object.hasOwn(SHOWS, key))

describe('Go now', () => {
  it('passes over the waits only: a retry, quota, the limits, a free slot and the window', () => {
    expect([...GO_NOW_SKIPS].sort()).toEqual(CODES.filter((code) => SHOWS[code]).sort())
  })

  it.each(CODES)('on an item held as %s', (code) => {
    expect(canGoNow({ holdCode: code })).toBe(SHOWS[code])
  })

  it('on a slot waiter from an older Pilot, which names no code', () => {
    expect(canGoNow({})).toBe(true)
  })
})
