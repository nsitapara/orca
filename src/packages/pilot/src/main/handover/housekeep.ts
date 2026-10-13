import type { PilotStore } from '../store/store'
import { HANDOVER_EXPIRY_MS, HANDOVER_RETENTION_MS } from '../store/store-handovers'

export { HANDOVER_RETENTION_MS }
const HOUR_MS = 60 * 60_000

// Run from the scheduler pass, at most once an hour: handovers pending longer than 7 days expire (their receiver is
// off, or never settles them), and settled ones older than 30 days are pruned. Null when it isn't due.
export function handoverHousekeeper(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void
): { passIfDue(): { expired: number; pruned: number } | null } {
  let last: number | null = null
  return {
    passIfDue() {
      const at = now()
      if (last !== null && at - last < HOUR_MS) {
        return null
      }
      last = at
      const done = store.handovers.housekeep(at, HANDOVER_EXPIRY_MS, HANDOVER_RETENTION_MS)
      if (done.expired > 0 || done.pruned > 0) {
        log(
          `[pilot] handovers: ${done.expired} pending past 7 days expired, ${done.pruned} settled past 30 days pruned`
        )
      }
      return done
    }
  }
}
