import type { TickItem } from '../../shared/api-types'

export type QuotaReading = { weekly: number | null; session: number | null }
export type QuotaReader = () => Promise<QuotaReading>

const NONE: QuotaReading = { weekly: null, session: null }
const LAST_GOOD_MAX_AGE = 60 * 60_000

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
