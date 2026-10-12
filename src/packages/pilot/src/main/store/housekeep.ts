import { writerGone } from './store-actions'
import type { PilotStore } from './store'

// What every start does to the store first: close ticks a stop left running, prune old ticks, and mark actions a
// stopped process left running as failed. Any process may run actions, and main and orcad may share a store, so only
// a gone writer's are closed.
export function housekeepStore(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void
): void {
  const kept = store.housekeep(now())
  const interrupted = store.actions.interruptRunning(now(), now(), writerGone)
  if (interrupted > 0) {
    log(`[pilot] store: ${interrupted} action(s) a stopped process left running marked failed`)
  }
  if (kept.interrupted > 0 || kept.pruned > 0) {
    log(
      `[pilot] store: ${kept.interrupted} interrupted tick(s) closed, ${kept.pruned} tick(s) older than 30 days removed`
    )
  }
}
