import type { SpendGroup, SpendPayload, SpendRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import type { SpendRaw } from '../store/store-spend'
import { localDay } from '../usage/buckets'

export const DEFAULT_SPEND_DAYS = 7
export const MAX_SPEND_DAYS = 3650

// The first local day of a window of `days` days ending today.
export function sinceDayFor(days: number, now: number): string {
  const d = new Date(now)
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)).getTime())
}

function labelOf(by: SpendGroup, raw: SpendRaw, names: ReadonlyMap<string, string>): string {
  if (by === 'automation') {
    return names.get(raw.key) ?? raw.key
  }
  if (by === 'mr') {
    return raw.itemLabel
  }
  if (by === 'skill' && raw.key === '') {
    return '(no skill)'
  }
  return raw.key
}

export function spendPayload(
  store: PilotStore,
  names: ReadonlyMap<string, string>,
  by: SpendGroup,
  days: number,
  now: number
): SpendPayload {
  const sinceDay = sinceDayFor(days, now)
  const rows: SpendRow[] = store.spend.byGroup(by, sinceDay).map((raw) => ({
    key: raw.key,
    label: labelOf(by, raw, names),
    costUsd: raw.costUsd,
    tokens: raw.tokens,
    runs: raw.runs,
    steps: raw.steps,
    unpricedBuckets: raw.unpricedBuckets
  }))
  return { by, days, sinceDay, rows, total: store.spend.totals(sinceDay) }
}
