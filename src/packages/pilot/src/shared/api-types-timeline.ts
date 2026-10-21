import type { RunRow, StepRow, Verdict } from './api-types'
import type { MergeBack } from './api-types-runs'
import type { InboxItemSummary } from './inbox-types'

// One automation's last word on this worktree: the newest finished real tick's verdict, and when it ticks next.
export type TimelineNext = {
  automationId: string
  automationName: string
  tickId: number
  tickAt: number
  itemKey: string
  label: string
  verdict: Verdict
  reason: string
  nextTickAt: number | null
}

export type TimelineRun = RunRow & {
  automationName: string
  steps: StepRow[]
  inbox: InboxItemSummary[]
  // How a kept branch's merge back stands; absent when nothing was kept, and from older Pilots.
  mergeBack?: MergeBack | null
}

export type WorktreeTimeline = {
  next: TimelineNext[]
  now: TimelineRun[]
  earlier: TimelineRun[]
  waiting: InboxItemSummary[]
  spentTodayUsd: number
  // Today's usage buckets with no price: the total is then "+ unpriced" (renderer spentLabel).
  unpricedBuckets: number
}

// pilot.session.resume (Task 31a): switched to the step's live tab, or opened its session in a new one.
export type SessionResumeResult = { action: 'focused' | 'opened'; handle: string }
