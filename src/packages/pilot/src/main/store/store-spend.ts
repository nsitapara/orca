import type Database from '../../../../../main/sqlite/sync-database'
import type { SpendGroup } from '../../shared/api-types'
import type { AgentKind } from '../../shared/definition/types'

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
  agent: 'COALESCE(u.agent, s.agent)',
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
// A bucket written before schema 21 has no agent of its own: its step's.
const AGENT = 'COALESCE(u.agent, s.agent)'

function agentOf(value: unknown): AgentKind {
  return value === 'codex' ? 'codex' : 'claude'
}

function costOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

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

export type ReportBucketRow = {
  automationId: string
  itemLabel: string
  worktreePath: string | null
  agent: string
  sessionId: string
  stepStartedAt: number
  day: string
  model: string
  requests: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  costUsd: number | null
}
// The Usage page's rows: one per automation, day and agent; or one per run and agent.
export type UsageSliceRow = {
  automationId: string
  day: string
  agent: AgentKind
  tokens: number
  costUsd: number | null
}
export type UsageRunSliceRow = {
  runId: string
  automationId: string
  itemLabel: string
  startedAt: number
  status: string
  agent: AgentKind
  tokens: number
  costUsd: number | null
}
export type SessionlessStep = {
  automationId: string
  agent: string
  startedAt: number
  worktreePath: string | null
  itemLabel: string
}

function toBucketRow(r: Record<string, unknown>): ReportBucketRow {
  return {
    automationId: String(r.automation_id),
    itemLabel: String(r.item_label),
    worktreePath: (r.worktree_path as string | null) ?? null,
    agent: String(r.agent),
    sessionId: String(r.session_id),
    stepStartedAt: Number(r.step_started_at),
    day: String(r.day),
    model: String(r.model),
    requests: Number(r.requests),
    input: Number(r.input),
    cacheRead: Number(r.cache_read),
    cacheWrite: Number(r.cache_write),
    output: Number(r.output),
    costUsd: (r.cost_usd as number | null) ?? null
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

  // `by` applies the same filter as byGroup, so a group's total equals the sum of the rows shown.
  totals(sinceDay: string, by?: SpendGroup): { costUsd: number; tokens: number; runs: number } {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(u.cost_usd), 0) AS cost, COALESCE(SUM(${TOKENS}), 0) AS tokens,
           COUNT(DISTINCT r.id) AS runs ${FROM} WHERE u.day >= ? ${by ? GROUP_FILTER[by] : ''}`
      )
      .get(sinceDay) as { cost: number; tokens: number; runs: number }
    return { costUsd: Number(r.cost), tokens: Number(r.tokens), runs: Number(r.runs) }
  }

  // Every bucket of a step that had a session, in usage.py's row order: day, start, model. worktree_path is where the session
  // ran (usage.json's cwd): an env run's folder, not its home.
  reportBuckets(): ReportBucketRow[] {
    return this.db
      .prepare(
        `SELECT r.automation_id, r.item_label, r.worktree_path, COALESCE(u.agent, s.agent) AS agent, s.session_id,
           s.started_at AS step_started_at, u.day, u.model, u.requests, u.input, u.cache_read,
           u.cache_write, u.output, u.cost_usd
         ${FROM} WHERE s.session_id IS NOT NULL ORDER BY u.day, s.started_at, u.model`
      )
      .all()
      .map((r) => toBucketRow(r as never))
  }

  usageSlices(sinceDay: string): UsageSliceRow[] {
    return this.db
      .prepare(
        `SELECT r.automation_id, u.day, ${AGENT} AS agent, SUM(${TOKENS}) AS tokens, SUM(u.cost_usd) AS cost
         ${FROM} WHERE u.day >= ? GROUP BY r.automation_id, u.day, ${AGENT} ORDER BY u.day`
      )
      .all(sinceDay)
      .map((r) => ({
        automationId: String(r.automation_id),
        day: String(r.day),
        agent: agentOf(r.agent),
        tokens: Number(r.tokens ?? 0),
        costUsd: costOf(r.cost)
      }))
  }

  usageRunSlices(sinceDay: string): UsageRunSliceRow[] {
    return this.db
      .prepare(
        `SELECT r.id, r.automation_id, r.item_label, r.started_at, r.status, ${AGENT} AS agent,
           SUM(${TOKENS}) AS tokens, SUM(u.cost_usd) AS cost
         ${FROM} WHERE u.day >= ? GROUP BY r.id, ${AGENT}`
      )
      .all(sinceDay)
      .map((r) => ({
        runId: String(r.id),
        automationId: String(r.automation_id),
        itemLabel: String(r.item_label ?? ''),
        startedAt: Number(r.started_at),
        status: String(r.status),
        agent: agentOf(r.agent),
        tokens: Number(r.tokens ?? 0),
        costUsd: costOf(r.cost)
      }))
  }

  // Agent steps whose usage isn't in yet: still going, or ended and waiting to be measured.
  pendingAgentSteps(): number {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM steps WHERE kind = 'agent' AND usage_measured_at IS NULL AND status NOT IN ('pending', 'skipped')"
      )
      .get() as { n: number }
    return Number(r.n)
  }

  // usage.py's gaps: an agent tab opened, but no session (or no transcript) was ever found for it. Where it ran, as above.
  sessionlessSteps(): SessionlessStep[] {
    return this.db
      .prepare(
        `SELECT r.automation_id, s.agent, s.started_at, r.worktree_path, r.item_label
         FROM steps s JOIN runs r ON r.id = s.run_id
         WHERE s.kind = 'agent' AND s.usage_measured_at IS NOT NULL AND s.tokens IS NULL
           AND s.terminal_handle IS NOT NULL
         ORDER BY s.started_at`
      )
      .all()
      .map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          automationId: String(r.automation_id),
          agent: String(r.agent),
          startedAt: Number(r.started_at),
          worktreePath: (r.worktree_path as string | null) ?? null,
          itemLabel: String(r.item_label)
        }
      })
  }
}
