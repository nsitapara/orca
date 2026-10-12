import type Database from '../../../../../main/sqlite/sync-database'
import type { SpendGroup } from '../../shared/api-types'

export type SpendRaw = {
  key: string
  itemLabel: string
  costUsd: number | null
  tokens: number
  runs: number
  steps: number
  unpricedBuckets: number
}

// Fixed SQL per group; never built from caller text.
const GROUP_KEY: Record<SpendGroup, string> = {
  automation: 'r.automation_id',
  skill: "COALESCE(s.skill, '')",
  agent: 's.agent',
  mr: 'r.item_key'
}
// Older (M1) runs keyed MRs as "!<iid>", v2 runs as "mr:<iid>".
const GROUP_FILTER: Record<SpendGroup, string> = {
  automation: '',
  skill: '',
  agent: '',
  mr: "AND (r.item_key LIKE 'mr:%' OR r.item_key LIKE '!%')"
}
const FROM =
  'FROM step_usage u JOIN steps s ON s.run_id = u.run_id AND s.idx = u.idx JOIN runs r ON r.id = u.run_id'
const TOKENS = 'u.input + u.cache_read + u.cache_write + u.output'

function toRaw(r: Record<string, unknown>): SpendRaw {
  return {
    key: String(r.k),
    itemLabel: String(r.item_label ?? ''),
    costUsd: (r.cost as number | null) ?? null,
    tokens: Number(r.tokens ?? 0),
    runs: Number(r.runs),
    steps: Number(r.steps),
    unpricedBuckets: Number(r.unpriced)
  }
}

export class SpendStore {
  constructor(private readonly db: Database) {}

  // Most expensive first; a group with no priced bucket sorts as $0.
  byGroup(by: SpendGroup, sinceDay: string): SpendRaw[] {
    return this.db
      .prepare(
        `SELECT ${GROUP_KEY[by]} AS k, MIN(r.item_label) AS item_label, SUM(u.cost_usd) AS cost,
           SUM(${TOKENS}) AS tokens, COUNT(DISTINCT r.id) AS runs,
           COUNT(DISTINCT s.run_id || ':' || s.idx) AS steps,
           SUM(CASE WHEN u.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         ${FROM} WHERE u.day >= ? ${GROUP_FILTER[by]}
         GROUP BY k ORDER BY COALESCE(cost, 0) DESC, k`
      )
      .all(sinceDay)
      .map((r) => toRaw(r as never))
  }

  totals(sinceDay: string): { costUsd: number; tokens: number; runs: number } {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(u.cost_usd), 0) AS cost, COALESCE(SUM(${TOKENS}), 0) AS tokens,
           COUNT(DISTINCT r.id) AS runs ${FROM} WHERE u.day >= ?`
      )
      .get(sinceDay) as { cost: number; tokens: number; runs: number }
    return { costUsd: Number(r.cost), tokens: Number(r.tokens), runs: Number(r.runs) }
  }
}
