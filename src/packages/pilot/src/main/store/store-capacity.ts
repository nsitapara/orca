import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow } from '../../shared/api-types'
import { toRun } from './run-rows'

export type QueuedItem = {
  automationId: string
  itemKey: string
  itemLabel: string
  queuedAt: number
  byHand: boolean
}

const RUN_LIMIT_KEY = 'run_limit'
// The heaviest job is judged on its recent runs, so a job that got lighter stops counting its old peaks.
export const RECENT_RUNS_FOR_PEAK = 20

function toQueued(r: Record<string, unknown>): QueuedItem {
  return {
    automationId: String(r.automation_id),
    itemKey: String(r.item_key),
    itemLabel: String(r.item_label),
    queuedAt: Number(r.queued_at),
    byHand: Number(r.by_hand) === 1
  }
}

// Run capacity: how many runs may go at once, the items waiting for a slot, and each run's memory peak.
export class CapacityStore {
  constructor(private readonly db: Database) {}

  // Null: no limit.
  runLimit(): number | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(RUN_LIMIT_KEY)
    const limit = Number(row?.value)
    return Number.isInteger(limit) && limit > 0 ? limit : null
  }

  setRunLimit(limit: number | null, at: number): void {
    if (limit === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(RUN_LIMIT_KEY)
      return
    }
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(RUN_LIMIT_KEY, String(limit), at)
  }

  // Oldest first: an item keeps the place it took the first time it had to wait.
  queued(): QueuedItem[] {
    return this.db
      .prepare('SELECT * FROM run_queue ORDER BY queued_at, rowid')
      .all()
      .map((r) => toQueued(r))
  }

  enqueue(item: QueuedItem): void {
    this.db
      .prepare(
        `INSERT INTO run_queue (automation_id, item_key, item_label, queued_at, by_hand) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (automation_id, item_key) DO UPDATE SET item_label = excluded.item_label,
           by_hand = MAX(by_hand, excluded.by_hand)`
      )
      .run(item.automationId, item.itemKey, item.itemLabel, item.queuedAt, item.byHand ? 1 : 0)
  }

  // The row it removed, so a start knows whether Run now queued it.
  dequeue(automationId: string, itemKey: string): QueuedItem | null {
    const row = this.db
      .prepare('SELECT * FROM run_queue WHERE automation_id = ? AND item_key = ?')
      .get(automationId, itemKey)
    if (!row) {
      return null
    }
    this.db
      .prepare('DELETE FROM run_queue WHERE automation_id = ? AND item_key = ?')
      .run(automationId, itemKey)
    return toQueued(row)
  }

  // An automation's rows for items its tick didn't leave waiting: they started, or aren't due any more.
  keepOnly(automationId: string, waiting: readonly string[]): void {
    this.db
      .prepare(
        'DELETE FROM run_queue WHERE automation_id = ? AND item_key NOT IN (SELECT value FROM json_each(?))'
      )
      .run(automationId, JSON.stringify(waiting))
  }

  forget(automationId: string): void {
    this.db.prepare('DELETE FROM run_queue WHERE automation_id = ?').run(automationId)
  }

  running(): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY started_at, id")
      .all()
      .map((r) => toRun(r))
  }

  recordPeak(runId: string, bytes: number): void {
    this.db
      .prepare('UPDATE runs SET peak_rss_bytes = MAX(COALESCE(peak_rss_bytes, 0), ?) WHERE id = ?')
      .run(bytes, runId)
  }

  peaks(runIds: readonly string[]): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT id, peak_rss_bytes AS peak FROM runs
         WHERE id IN (SELECT value FROM json_each(?)) AND peak_rss_bytes IS NOT NULL`
      )
      .all(JSON.stringify(runIds))
    return new Map(rows.map((r) => [String(r.id), Number(r.peak)]))
  }

  // Each automation's highest peak over its RECENT_RUNS_FOR_PEAK newest measured runs.
  heaviestPeaks(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT automation_id, MAX(peak_rss_bytes) AS peak FROM (
           SELECT automation_id, peak_rss_bytes,
             ROW_NUMBER() OVER (PARTITION BY automation_id ORDER BY started_at DESC) AS n
           FROM runs WHERE peak_rss_bytes IS NOT NULL)
         WHERE n <= ? GROUP BY automation_id`
      )
      .all(RECENT_RUNS_FOR_PEAK)
    return new Map(rows.map((r) => [String(r.automation_id), Number(r.peak)]))
  }
}
