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
