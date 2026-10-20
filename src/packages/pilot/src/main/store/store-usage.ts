import type Database from '../../../../../main/sqlite/sync-database'
import type { AdvanceStore } from './store-advance'
import type { AgentKind } from '../../shared/definition/types'
import { totalsOf, type UsageBucket } from '../usage/buckets'

export type MeasurableStep = {
  runId: string
  idx: number
  agent: string
  sessionId: string | null
  transcriptPath: string | null
  startedAt: number | null
  finishedAt: number | null
  // Where the run worked (an env run's folder): its agent's child sessions ran there.
  worktreePath: string | null
}

function toMeasurable(r: Record<string, unknown>): MeasurableStep {
  return {
    runId: String(r.run_id),
    idx: Number(r.idx),
    agent: String(r.agent),
    sessionId: (r.session_id as string | null) ?? null,
    transcriptPath: (r.transcript_path as string | null) ?? null,
    startedAt: (r.started_at as number | null) ?? null,
    finishedAt: (r.finished_at as number | null) ?? null,
    worktreePath: typeof r.worktree_path === 'string' ? r.worktree_path : null
  }
}

function agentOf(value: unknown): AgentKind {
  return value === 'codex' ? 'codex' : 'claude'
}

function toBucket(r: Record<string, unknown>): UsageBucket {
  return {
    agent: agentOf(r.agent),
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

export class UsageStore {
  constructor(
    private readonly db: Database,
    private readonly advance: AdvanceStore
  ) {}

  // Agent steps that ended and haven't had their usage read, oldest first, a page at a time.
  unmeasuredSteps(limit = 50): MeasurableStep[] {
    return this.db
      .prepare(
        `SELECT s.run_id, s.idx, s.agent, s.session_id, s.transcript_path, s.started_at, s.finished_at,
           r.worktree_path FROM steps s JOIN runs r ON r.id = s.run_id
         WHERE s.kind = 'agent' AND s.usage_measured_at IS NULL AND s.finished_at IS NOT NULL
           AND s.status IN ('done', 'failed', 'timed_out')
         ORDER BY s.finished_at, s.run_id, s.idx LIMIT ?`
      )
      .all(limit)
      .map((r) => toMeasurable(r as never))
  }

  // Replaces the step's buckets and sets its cost, tokens and model, then re-sums the run (run cost = sum of its
  // steps, even when the run already closed), all in one transaction. A step whose session can't be found is only
  // marked measured: what it already has (an earlier read, the watcher's) is kept, so a pruned transcript never
  // erases a historical cost. One found with no turns in its window has 0 tokens.
  saveStepUsage(
    runId: string,
    idx: number,
    buckets: readonly UsageBucket[],
    sessionFound: boolean,
    at: number
  ): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (sessionFound) {
        this.writeBuckets(runId, idx, buckets, at)
      } else {
        this.db
          .prepare('UPDATE steps SET usage_measured_at = ? WHERE run_id = ? AND idx = ?')
          .run(at, runId, idx)
      }
      const spent = this.advance.rollupCost(runId)
      this.db
        .prepare('UPDATE runs SET cost_usd = ?, tokens = ? WHERE id = ?')
        .run(spent.costUsd, spent.tokens, runId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // Gives up on a step whose usage can't be read, so it stops being offered; its cost stays as it is.
  markMeasured(runId: string, idx: number, at: number): void {
    this.db
      .prepare('UPDATE steps SET usage_measured_at = ? WHERE run_id = ? AND idx = ?')
      .run(at, runId, idx)
  }

  private writeBuckets(
    runId: string,
    idx: number,
    buckets: readonly UsageBucket[],
    at: number
  ): void {
    const totals = totalsOf(buckets)
    const insert = this.db.prepare(
      'INSERT INTO step_usage (run_id, idx, day, model, requests, input, cache_read, cache_write, output, cost_usd, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    this.db.prepare('DELETE FROM step_usage WHERE run_id = ? AND idx = ?').run(runId, idx)
    for (const b of buckets) {
      insert.run(
        runId,
        idx,
        b.day,
        b.model,
        b.requests,
        b.input,
        b.cacheRead,
        b.cacheWrite,
        b.output,
        b.costUsd,
        b.agent
      )
    }
    this.db
      .prepare(
        'UPDATE steps SET cost_usd = ?, tokens = ?, model = COALESCE(?, model), usage_measured_at = ? WHERE run_id = ? AND idx = ?'
      )
      .run(totals.costUsd, totals.tokens, totals.model, at, runId, idx)
  }

  stepBuckets(runId: string, idx: number): UsageBucket[] {
    return this.db
      .prepare(
        `SELECT u.*, COALESCE(u.agent, s.agent) AS agent FROM step_usage u
         JOIN steps s ON s.run_id = u.run_id AND s.idx = u.idx
         WHERE u.run_id = ? AND u.idx = ? ORDER BY u.day, u.model`
      )
      .all(runId, idx)
      .map((r) => toBucket(r as never))
  }

  // Every session a step owns: another step's session is never counted as a child of this one.
  sessionIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT DISTINCT session_id FROM steps WHERE session_id IS NOT NULL')
      .all()
    return new Set(rows.flatMap((r) => (typeof r.session_id === 'string' ? [r.session_id] : [])))
  }

  lastMeasuredAt(): number | null {
    const row = this.db.prepare('SELECT MAX(usage_measured_at) AS at FROM steps').get() as
      | { at: number | null }
      | undefined
    return row?.at ?? null
  }

  // What runs in this worktree spent on one local day (steps are counted once they end), and how many of
  // those buckets had no price. `paths` are the spellings the worktree may be stored under.
  costForWorktreeOn(
    paths: readonly string[],
    day: string
  ): { costUsd: number; unpricedBuckets: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(u.cost_usd), 0) AS c,
                COALESCE(SUM(CASE WHEN u.cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced
         FROM step_usage u JOIN runs r ON r.id = u.run_id
         WHERE (r.home_path IN (SELECT value FROM json_each(?))
             OR (r.home_path IS NULL AND r.worktree_path IN (SELECT value FROM json_each(?)))) AND u.day = ?`
      )
      .get(JSON.stringify(paths), JSON.stringify(paths), day) as { c: number; unpriced: number }
    return { costUsd: Number(row.c), unpricedBuckets: Number(row.unpriced) }
  }
}
