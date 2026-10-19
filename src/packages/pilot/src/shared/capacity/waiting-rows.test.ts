import { describe, expect, it } from 'vitest'
import type { QueuedRun } from '../api-types-capacity'
import { holdReasonText, waitedText } from './waiting-rows'

const NOW = Date.UTC(2026, 9, 18, 19, 46)
const H = 60 * 60_000

function row(over: Partial<QueuedRun>): QueuedRun {
  return {
    automationId: 'review',
    automationName: '03 Review and fix',
    itemKey: 'wt:1',
    itemLabel: 'web-2099',
    queuedAt: NOW - 3 * H,
    byHand: false,
    ...over
  }
}

describe('waitedText', () => {
  it.each<[string, Partial<QueuedRun>, string]>([
    [
      'a slot waiter, since it became due',
      { dueAt: NOW - 5 * H, holdCode: 'capacity' },
      'waiting 5h'
    ],
    [
      'a held row, then how long ago it became due',
      {
        dueAt: NOW - 48 * H,
        holdCode: 'in_flight',
        heldAt: NOW - 3 * H,
        dueFrom: 'oldest new commit'
      },
      'held 3h · oldest new commit 48h ago'
    ],
    [
      'a row held since it became due, once',
      { dueAt: NOW - 3 * H, holdCode: 'quota', heldAt: NOW - 3 * H, dueFrom: 'first due' },
      'held 3h'
    ],
    [
      'a held row from an older Pilot, as before',
      { dueAt: NOW - 48 * H, holdCode: 'in_flight' },
      'waiting 48h'
    ]
  ])('%s', (_name, over, text) => {
    expect(waitedText(row(over), NOW)).toBe(text)
  })
})

describe('holdReasonText', () => {
  it.each<[string, Partial<QueuedRun>, string | null]>([
    [
      'a dirty worktree, with what frees it',
      { holdCode: 'in_flight', holdDetail: '53 uncommitted files' },
      '53 uncommitted files. It starts once the worktree is clean: changes committed or stashed, no rebase or merge running.'
    ],
    [
      'a detail that already says when, alone',
      { holdCode: 'retry', holdDetail: 'Retry 1 of 2 at 3:10 PM. Last run failed' },
      'Retry 1 of 2 at 3:10 PM. Last run failed'
    ],
    [
      'a slot waiter, its detail',
      { holdCode: 'capacity', holdDetail: 'Waiting for a slot: 1 of 1 running' },
      'Waiting for a slot: 1 of 1 running'
    ],
    ['a row from an older Pilot, nothing', {}, null]
  ])('%s', (_name, over, text) => {
    expect(holdReasonText(row(over))).toBe(text)
  })
})
