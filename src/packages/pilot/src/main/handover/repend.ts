import type { PilotStore } from '../store/store'

// Every path that ends a run failed or timed out calls this (closeRun, a launch released or orphaned, start_run, the
// stale-start sweep): the handed-over ids that run took go back to pending, so the receiving stage's next tick
// retries them once retry_after_failure allows. Their 7-day expiry still counts from when they were handed over.
export function repend(store: PilotStore, runId: string): void {
  store.handovers.reopen(runId)
}
