import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import type { ItemFields } from '../../shared/api-types'
import type { AgentKind } from '../../shared/definition/types'

export type QuotaReading = { weekly: number | null; session: number | null }
export type QuotaReader = () => Promise<QuotaReading>

const NONE: QuotaReading = { weekly: null, session: null }
const LAST_GOOD_MAX_AGE = 60 * 60_000
const READ_TIMEOUT_MS = 60_000

// A reader that never settles must not hang every caller sharing the read in flight: after the timeout
// the read counts as failed, like any other failure.
function withTimeout(read: QuotaReader, timeoutMs: number): Promise<QuotaReading> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Quota read timed out')), timeoutMs)
  })
  return Promise.race([read(), timeout]).finally(() => clearTimeout(timer))
}

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

// Same rule as worktree-gate's quota.py: an answer, a failed read included, is reused for 5 min, so a
// Codex that keeps failing or hanging is probed once per ttl, not once per tick; concurrent callers
// share the read in flight. A failed read answers with the last good reading from the past hour; with
// nothing to go on it answers nulls, and the quota check lets the run start (fail-open by design).
export function cachedQuota(
  read: QuotaReader,
  ttlMs = 5 * 60_000,
  now: () => number = Date.now,
  timeoutMs = READ_TIMEOUT_MS
): QuotaReader {
  let good: { at: number; value: QuotaReading } | null = null
  let answer: { at: number; value: QuotaReading } | null = null
  let inflight: Promise<QuotaReading> | null = null
  async function refresh(): Promise<QuotaReading> {
    let value: QuotaReading
    try {
      value = await withTimeout(read, timeoutMs)
      good = { at: now(), value }
    } catch {
      value = good && now() - good.at < LAST_GOOD_MAX_AGE ? good.value : NONE
    }
    answer = { at: now(), value }
    return value
  }
  return async () => {
    if (inflight) {
      return inflight
    }
    if (answer && now() - answer.at < ttlMs) {
      return answer.value
    }
    inflight = refresh().finally(() => {
      inflight = null
    })
    return inflight
  }
}

export type QuotaReaders = Record<AgentKind, QuotaReader>

// No reader for this agent in this process (orcad passes none): the quota check lets runs start.
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
