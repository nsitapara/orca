import type Database from '../../../../../main/sqlite/sync-database'
import type { HoldReason, RunRow } from '../../shared/api-types'
import { clampRetryLimit, DEFAULT_RETRY_LIMIT } from '../../shared/capacity/retry-limit'
import { toRun } from './run-rows'

export type QueuedItem = {
  automationId: string
  itemKey: string
  itemLabel: string
  queuedAt: number
  byHand: boolean
  dueAt: number
  holdCode: HoldReason
  holdDetail: string
  checkedAt: number
  // When a hold that knows its end is over (a retry's wait): it is re-checked then. Absent for any other.
  recheckAt?: number
}

const RUN_LIMIT_KEY = 'run_limit'
const RETRY_LIMIT_KEY = 'retry_limit'
// The heaviest job is judged on its recent runs, so a job that got lighter stops counting its old peaks.
export const RECENT_RUNS_FOR_PEAK = 20

// A Record keeps this exhaustive: a new HoldReason member fails typecheck here.
const HOLD_REASON_SET: Record<HoldReason, true> = {
  worktree_busy: true,
  typing: true,
  claimed: true,
  quota: true,
  no_worktree: true,
  mr_unknown: true,
  in_flight: true,
  waits: true,
  retry: true,
  capacity: true,
  window: true,
  session_open: true,
  answers_pending: true,
  job_limit: true,
  tick_limit: true
}
const HOLD_REASONS = Object.keys(HOLD_REASON_SET)

function isHoldReason(value: unknown): value is HoldReason {
  return typeof value === 'string' && HOLD_REASONS.includes(value)
}

// Rows an older process wrote have a NULL due_at, so they sort by when they joined.
const LINE_ORDER = 'COALESCE(due_at, queued_at), queued_at, rowid'

// A newer process may store a code this one doesn't know; it still waits for a slot here.
function toHoldReason(stored: unknown): HoldReason {
  return isHoldReason(stored) ? stored : 'capacity'
}

function toQueued(r: Record<string, unknown>): QueuedItem {
  return {
    automationId: String(r.automation_id),
    itemKey: String(r.item_key),
    itemLabel: String(r.item_label),
    queuedAt: Number(r.queued_at),
    byHand: Number(r.by_hand) === 1,
    // Null on rows an older process wrote.
    dueAt: Number(r.due_at ?? r.queued_at),
    holdCode: toHoldReason(r.hold_code),
    holdDetail: String(r.hold_detail ?? ''),
    checkedAt: Number(r.checked_at ?? r.queued_at),
    ...(typeof r.recheck_at === 'number' ? { recheckAt: r.recheck_at } : {})
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
    this.setSetting(RUN_LIMIT_KEY, limit, at)
  }

  // How many times a failed run is tried again before the runner gives up.
  retryLimit(): number {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(RETRY_LIMIT_KEY)
    const limit = Number(row?.value)
    return row && Number.isInteger(limit) ? clampRetryLimit(limit) : DEFAULT_RETRY_LIMIT
  }

  setRetryLimit(limit: number, at: number): void {
    this.setSetting(RETRY_LIMIT_KEY, clampRetryLimit(limit), at)
  }

  private setSetting(key: string, value: number, at: number): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, String(value), at)
  }

  // Earliest due first: an item keeps the place its due time earned, whenever it joined.
  queued(): QueuedItem[] {
    return this.db
      .prepare(`SELECT * FROM run_queue ORDER BY ${LINE_ORDER}`)
      .all()
      .map((r) => toQueued(r))
  }

  queuedFor(keys: readonly string[]): QueuedItem[] {
    return this.db
      .prepare(
        `SELECT * FROM run_queue WHERE item_key IN (SELECT value FROM json_each(?))
         ORDER BY ${LINE_ORDER}`
      )
      .all(JSON.stringify(keys))
      .map((r) => toQueued(r))
  }

  // changed: the row is new or its reason differs, so callers write a line only when something moved.
  enqueue(item: QueuedItem): { changed: boolean } {
    const before = this.db
      .prepare(
        'SELECT hold_code, hold_detail FROM run_queue WHERE automation_id = ? AND item_key = ?'
      )
      .get(item.automationId, item.itemKey)
    this.db
      .prepare(
        `INSERT INTO run_queue (automation_id, item_key, item_label, queued_at, by_hand, due_at, hold_code, hold_detail, checked_at, recheck_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (automation_id, item_key) DO UPDATE SET item_label = excluded.item_label,
           by_hand = MAX(by_hand, excluded.by_hand),
           due_at = MIN(COALESCE(due_at, queued_at), excluded.due_at),
           hold_code = excluded.hold_code, hold_detail = excluded.hold_detail, checked_at = excluded.checked_at,
           recheck_at = excluded.recheck_at`
      )
      .run(
        item.automationId,
        item.itemKey,
        item.itemLabel,
        item.queuedAt,
        item.byHand ? 1 : 0,
        item.dueAt,
        item.holdCode,
        item.holdDetail,
        item.checkedAt,
        item.recheckAt ?? null
      )
    return {
      changed:
        !before || before.hold_code !== item.holdCode || before.hold_detail !== item.holdDetail
    }
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

  // A hold whose end has passed falls back to its interval, so a failing re-check isn't retried every loop.
  markChecked(automationId: string, at: number): void {
    this.db
      .prepare(
        `UPDATE run_queue SET checked_at = ?,
           recheck_at = CASE WHEN recheck_at <= ? THEN NULL ELSE recheck_at END
         WHERE automation_id = ?`
      )
      .run(at, at, automationId)
  }

  // A NULL code is an older process's row, which only ever waited for a slot.
  forgetSlotWaiters(automationId: string): void {
    this.db
      .prepare(
        "DELETE FROM run_queue WHERE automation_id = ? AND COALESCE(hold_code, 'capacity') = 'capacity'"
      )
      .run(automationId)
  }

  running(): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY started_at, id")
      .all()
      .map((r) => toRun(r))
  }

  // These automations' newest ended runs; imported runs never went through the line.
  finished(automationIds: readonly string[], limit: number): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE finished_at IS NOT NULL AND imported = 0
           AND automation_id IN (SELECT value FROM json_each(?))
         ORDER BY finished_at DESC, id DESC LIMIT ?`
      )
      .all(JSON.stringify(automationIds), limit)
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
