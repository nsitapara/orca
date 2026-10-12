import type Database from '../../../../../main/sqlite/sync-database'
import { totalsOf, type UsageBucket } from '../usage/buckets'

export type MeasurableStep = {
  runId: string
  idx: number
  agent: string
  sessionId: string | null
  transcriptPath: string | null
  startedAt: number | null
  finishedAt: number | null
}

function toMeasurable(r: Record<string, unknown>): MeasurableStep {
  return {
    runId: String(r.run_id),
    idx: Number(r.idx),
    agent: String(r.agent),
    sessionId: (r.session_id as string | null) ?? null,
    transcriptPath: (r.transcript_path as string | null) ?? null,
    startedAt: (r.started_at as number | null) ?? null,
    finishedAt: (r.finished_at as number | null) ?? null
  }
}

function toBucket(r: Record<string, unknown>): UsageBucket {
  return {
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
  constructor(private readonly db: Database) {}

  // Agent steps that ended and haven't had their usage read, oldest first, a page at a time.
  unmeasuredSteps(limit = 50): MeasurableStep[] {
    return this.db
      .prepare(
        `SELECT run_id, idx, agent, session_id, transcript_path, started_at, finished_at FROM steps
         WHERE kind = 'agent' AND usage_measured_at IS NULL AND finished_at IS NOT NULL
           AND status IN ('done', 'failed', 'timed_out')
         ORDER BY finished_at, run_id, idx LIMIT ?`
      )
      .all(limit)
      .map((r) => toMeasurable(r as never))
  }

  // Replaces the step's buckets and sets its cost, tokens and model. A step whose session was never found keeps
  // a null cost and null tokens; one found with no turns in its window has 0 tokens.
  saveStepUsage(
    runId: string,
    idx: number,
    buckets: readonly UsageBucket[],
    sessionFound: boolean,
    at: number
  ): void {
    const totals = totalsOf(buckets)
    const tokens = sessionFound ? totals.tokens : null
    const insert = this.db.prepare(
      'INSERT INTO step_usage (run_id, idx, day, model, requests, input, cache_read, cache_write, output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
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
          b.costUsd
        )
      }
      this.db
        .prepare(
          'UPDATE steps SET cost_usd = ?, tokens = ?, model = COALESCE(?, model), usage_measured_at = ? WHERE run_id = ? AND idx = ?'
        )
        .run(totals.costUsd, tokens, totals.model, at, runId, idx)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // A run costs what its steps cost (spec: run cost = sum of steps). SUM over only nulls stays null.
  rollupRun(runId: string): void {
    this.db
      .prepare(
        'UPDATE runs SET cost_usd = (SELECT SUM(cost_usd) FROM steps WHERE run_id = ?), tokens = (SELECT SUM(tokens) FROM steps WHERE run_id = ?) WHERE id = ?'
      )
      .run(runId, runId, runId)
  }

  stepBuckets(runId: string, idx: number): UsageBucket[] {
    return this.db
      .prepare('SELECT * FROM step_usage WHERE run_id = ? AND idx = ? ORDER BY day, model')
      .all(runId, idx)
      .map((r) => toBucket(r as never))
  }

  lastMeasuredAt(): number | null {
    const row = this.db.prepare('SELECT MAX(usage_measured_at) AS at FROM steps').get() as
      | { at: number | null }
      | undefined
    return row?.at ?? null
  }
}
