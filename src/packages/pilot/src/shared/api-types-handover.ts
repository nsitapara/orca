import type { Verdict } from './api-types'

// Multi-stage jobs (job.feeds … pass): an id one stage's run handed the next stage, pending until a tick of that stage
// reads it, then consumed with how that tick decided its item.
export type HandoverState = 'pending' | 'consumed'
export type HandoverRow = {
  id: number
  senderId: string
  senderRunId: string
  receiverId: string
  itemId: string
  createdAt: number
  state: HandoverState
  consumedAt: number | null
  // The receiving tick that read it, its verdict on the item (null: the source returned no such item), the reason,
  // and the run it started.
  tickId: number | null
  verdict: Verdict | null
  reason: string | null
  runId: string | null
}
// What a feed's run: now records on the tick it starts: the sender's run and the ids it handed over.
export type TickTrigger = {
  automationId: string
  runId: string
  stage: number | null
  ids: string[]
}
// What a tick of a stage says about handovers (TickResult.handover): the handed-over ids it read, and for each feed
// that passes ids or runs now, what its runs hand on (`starts`: the runs this tick started, or would start in a dry
// run). A dry run hands nothing over and triggers nothing.
export type FeedPreview = {
  to: string
  output: string | null
  run: 'now' | 'next_schedule'
  when: 'success' | 'always'
  starts: number
}
export type TickHandover = { read: string[]; feeds: FeedPreview[] }
