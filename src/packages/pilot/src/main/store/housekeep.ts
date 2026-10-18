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

const HOUR_MS = 60 * 60_000

// Re-check ticks pile up between starts, so the scheduler's loop prunes them at most once an hour.
export function recheckPruner(
  store: Pick<PilotStore, 'pruneRechecks'>,
  now: () => number,
  log: (message: string) => void
): () => void {
  let last = Number.NEGATIVE_INFINITY
  return () => {
    const at = now()
    if (at - last < HOUR_MS) {
      return
    }
    last = at
    const pruned = store.pruneRechecks(at)
    if (pruned > 0) {
      log(`[pilot] store: ${pruned} re-check tick(s) older than a day removed`)
    }
  }
}
