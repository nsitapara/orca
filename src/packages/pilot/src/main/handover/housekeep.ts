import type { PilotStore } from '../store/store'
import { HANDOVER_EXPIRY_MS, HANDOVER_RETENTION_MS } from '../store/store-handovers'

export { HANDOVER_RETENTION_MS }
const HOUR_MS = 60 * 60_000
export const HANDOVER_EXPIRED_EVENT = 'handover_expired'

// Run from the scheduler pass, at most once an hour: handovers pending longer than 7 days expire (their receiver is
// off, or never settles them), each with an Activity event on the receiving stage, and settled ones older than 30
// days are pruned. `stageOf` names the sender's stage. Null when it isn't due.
export function handoverHousekeeper(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void,
  stageOf: (automationId: string) => number | null = () => null
): { passIfDue(): { expired: number; pruned: number } | null } {
  let last: number | null = null
  return {
    passIfDue() {
      const at = now()
      if (last !== null && at - last < HOUR_MS) {
        return null
      }
      last = at
      const done = store.transaction(() => {
        const result = store.handovers.housekeep(at, HANDOVER_EXPIRY_MS, HANDOVER_RETENTION_MS)
        for (const h of result.expired) {
          const stage = stageOf(h.senderId)
          const from = stage === null ? h.senderId : `stage ${stage}`
          store.events.add({
            at,
            kind: HANDOVER_EXPIRED_EVENT,
            automationId: h.receiverId,
            itemKey: h.itemId,
            payload: { text: `Handover of ${h.itemId} from ${from} expired after 7 days` }
          })
        }
        return { expired: result.expired.length, pruned: result.pruned }
      })
      if (done.expired > 0 || done.pruned > 0) {
        log(
          `[pilot] handovers: ${done.expired} pending past 7 days expired, ${done.pruned} settled past 30 days pruned`
        )
      }
      return done
    }
  }
}
