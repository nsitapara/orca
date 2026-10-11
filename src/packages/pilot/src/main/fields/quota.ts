import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import type { TickItem } from '../../shared/api-types'

export type QuotaReading = { weekly: number | null; session: number | null }
export type QuotaReader = () => Promise<QuotaReading>

const NONE: QuotaReading = { weekly: null, session: null }
const LAST_GOOD_MAX_AGE = 60 * 60_000

// Orca's fetch does not throw on a 429, a stale token or missing credentials: it returns status 'error'
// with null windows. Throwing here lets cachedQuota keep the last good reading instead of overwriting it.
export function toQuotaReading(
  limits: Pick<ProviderRateLimits, 'status' | 'weekly' | 'session'>
): QuotaReading {
  if (limits.status !== 'ok') {
    throw new Error(`Claude usage unavailable (${limits.status})`)
  }
  return {
    weekly: limits.weekly?.usedPercent ?? null,
    session: limits.session?.usedPercent ?? null
  }
}

// Same rule as worktree-gate's quota.py: cache 5 min; on a failed read use the last good reading from the
// past hour; with nothing to go on, return nulls and the quota check lets the run start (fail-open by design).
export function cachedQuota(
  read: QuotaReader,
  ttlMs = 5 * 60_000,
  now: () => number = Date.now
): QuotaReader {
  let last: { at: number; value: QuotaReading } | null = null
  return async () => {
    if (last && now() - last.at < ttlMs) {
      return last.value
    }
    try {
      last = { at: now(), value: await read() }
      return last.value
    } catch {
      if (last && now() - last.at < LAST_GOOD_MAX_AGE) {
        return last.value
      }
      return NONE
    }
  }
}

export function addQuotaFields(items: TickItem[], q: QuotaReading): TickItem[] {
  return items.map((i) => ({
    ...i,
    fields: {
      ...i.fields,
      'quota.claude.weekly_pct': q.weekly,
      'quota.claude.session_pct': q.session
    }
  }))
}
