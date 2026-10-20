import type Database from '../../../../../main/sqlite/sync-database'
import type { SqliteRow } from '../../../../../main/sqlite/sqlite-statement'
import type { HandledRow, HandledStatus } from '../../shared/api-types'
import { STOPPED_BY_YOU } from '../../shared/run/stopped-run'

// A key the runner gave up on, with the item its last run was about.
export type GaveUpRow = HandledRow & { automationId: string; itemLabel: string }

const STATUSES: readonly HandledStatus[] = ['started', 'done', 'failed']
// Each key with the outcome and item of the run that holds it.
const WITH_RUN = `SELECT h.*, r.outcome AS last_outcome, r.item_label AS run_item_label
  FROM handled h LEFT JOIN runs r ON r.id = h.run_id`
// The keys Retry frees: a failed one, and the done one a run Stop ended still holds (Stop settles its key done).
const RETRYABLE = `(handled.status = 'failed' OR (handled.status = 'done' AND EXISTS (SELECT 1 FROM runs
  WHERE runs.id = handled.run_id AND runs.status = 'cancelled' AND (runs.outcome = ? OR runs.outcome LIKE ?))))`
const STOPPED = [STOPPED_BY_YOU, `${STOPPED_BY_YOU}; %`] as const

// A status this process doesn't know reads as started: never retried.
function toStatus(value: unknown): HandledStatus {
  return STATUSES.find((s) => s === value) ?? 'started'
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toHandled(r: SqliteRow): HandledRow {
  return {
    onceKey: String(r.once_key),
    runId: textOrNull(r.run_id),
    at: Number(r.at),
    status: toStatus(r.status),
    failedAt: typeof r.failed_at === 'number' ? r.failed_at : null,
    failures: Number(r.failures ?? 0),
    lastOutcome: textOrNull(r.last_outcome)
  }
}

// The once_per keys each automation handled: the run holding each, how it ended, and its failures in a row.
export class HandledStore {
  constructor(private readonly db: Database) {}

  keys(automationId: string): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT once_key FROM handled WHERE automation_id = ?')
        .all(automationId)
        .map((r) => String(r.once_key))
    )
  }

  // A run on a key starts it over and keeps its failures, so a retry still counts toward the limit.
  mark(automationId: string, onceKey: string, runId: string | null, at: number): void {
    this.db
      .prepare(
        `INSERT INTO handled (automation_id, once_key, run_id, at) VALUES (?, ?, ?, ?)
         ON CONFLICT (automation_id, once_key) DO UPDATE SET run_id = excluded.run_id,
           at = excluded.at, status = 'started', failed_at = NULL`
      )
      .run(automationId, onceKey, runId, at)
  }

  unmark(automationId: string, onceKey: string): void {
    this.db
      .prepare('DELETE FROM handled WHERE automation_id = ? AND once_key = ?')
      .run(automationId, onceKey)
  }

  unmarkForRun(automationId: string, runId: string): void {
    this.db
      .prepare('DELETE FROM handled WHERE automation_id = ? AND run_id = ?')
      .run(automationId, runId)
  }

  rows(automationId: string): HandledRow[] {
    return this.db
      .prepare(`${WITH_RUN} WHERE h.automation_id = ? ORDER BY h.once_key`)
      .all(automationId)
      .map(toHandled)
  }

  // A failure counts one more, a done run clears the count; the count the key has now (0 when no key is the run's).
  settle(automationId: string, runId: string, status: HandledStatus, at: number): number {
    const row = this.db
      .prepare(
        `UPDATE handled SET status = ?, failed_at = ?,
           failures = CASE ? WHEN 'failed' THEN failures + 1 WHEN 'done' THEN 0 ELSE failures END
         WHERE automation_id = ? AND run_id = ? RETURNING failures`
      )
      .get(status, status === 'failed' ? at : null, status, automationId, runId)
    return Number(row?.failures ?? 0)
  }

  // Retry: a failed or stopped run's key is freed, so it is due; a key a run holds stays. Returns its run's item key.
  resetFailures(automationId: string, onceKey: string): string | null {
    const freed = this.db
      .prepare(
        `DELETE FROM handled WHERE automation_id = ? AND once_key = ? AND ${RETRYABLE}
         RETURNING run_id`
      )
      .get(automationId, onceKey, ...STOPPED)
    const runId = textOrNull(freed?.run_id)
    if (runId === null) {
      return null
    }
    return textOrNull(
      this.db.prepare('SELECT item_key FROM runs WHERE id = ?').get(runId)?.item_key
    )
  }

  // Failed keys past `limit` whose last failure is at or after `since`, newest first, across automations.
  gaveUp(limit: number, since: number): GaveUpRow[] {
    return this.db
      .prepare(
        `${WITH_RUN} WHERE h.status = 'failed' AND h.failures > ? AND h.failed_at >= ?
         ORDER BY h.failed_at DESC, h.automation_id, h.once_key`
      )
      .all(limit, since)
      .map((r) => ({
        ...toHandled(r),
        automationId: String(r.automation_id),
        itemLabel: textOrNull(r.run_item_label) ?? String(r.once_key)
      }))
  }

  // The key each of these runs still holds that Retry frees: run id → once key.
  retryKeysOf(runIds: readonly string[]): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT run_id, once_key FROM handled
         WHERE run_id IN (SELECT value FROM json_each(?)) AND ${RETRYABLE}`
      )
      .all(JSON.stringify(runIds), ...STOPPED)
    return new Map(rows.map((r) => [String(r.run_id), String(r.once_key)]))
  }
}
