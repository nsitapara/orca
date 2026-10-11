import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import type { ItemFields, TickItem } from '../../shared/api-types'
import type { AgentKind } from '../../shared/definition/types'

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

export function addQuotaFields<I extends TickItem>(items: I[], q: QuotaReading): I[] {
  return items.map((i) => ({
    ...i,
    fields: {
      ...i.fields,
      'quota.claude.weekly_pct': q.weekly,
      'quota.claude.session_pct': q.session
    }
  }))
}

export type QuotaReaders = Record<AgentKind, QuotaReader>

// No reader for this agent in this process (orcad; Codex until Task 18): the quota check lets runs start.
export const NO_QUOTA: QuotaReader = async () => NONE

export function cachedQuotas(
  readers: Partial<Record<AgentKind, QuotaReader>> = {},
  ttlMs?: number,
  now?: () => number
): QuotaReaders {
  return {
    claude: cachedQuota(readers.claude ?? NO_QUOTA, ttlMs, now),
    codex: cachedQuota(readers.codex ?? NO_QUOTA, ttlMs, now)
  }
}

export async function readQuotas(readers: QuotaReaders): Promise<Record<AgentKind, QuotaReading>> {
  const read = (reader: QuotaReader) => reader().catch(() => NONE)
  const [claude, codex] = await Promise.all([read(readers.claude), read(readers.codex)])
  return { claude, codex }
}

export function quotaFields(readings: Record<AgentKind, QuotaReading>): ItemFields {
  return {
    'quota.claude.weekly_pct': readings.claude.weekly,
    'quota.claude.session_pct': readings.claude.session,
    'quota.codex.weekly_pct': readings.codex.weekly,
    'quota.codex.session_pct': readings.codex.session
  }
}
