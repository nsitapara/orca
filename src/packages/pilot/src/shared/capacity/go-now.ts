import type { HoldReason } from '../api-types'
import type { QueuedRun } from '../api-types-capacity'
import { waitsForSlot } from './waiting-rows'

// The runner's waits, which Go now passes over once; every other hold stands (a busy worktree, the job's own run).
export const GO_NOW_SKIPS: ReadonlySet<HoldReason> = new Set<HoldReason>([
  'retry',
  'quota',
  'job_limit',
  'tick_limit',
  'capacity',
  'window'
])

// A slot waiter (an older Pilot's names no code), or an item held only by one of the runner's waits.
export function canGoNow(item: Pick<QueuedRun, 'holdCode'>): boolean {
  return waitsForSlot(item) || (item.holdCode !== undefined && GO_NOW_SKIPS.has(item.holdCode))
}
