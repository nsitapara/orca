import Database from '../../../../../main/sqlite/sync-database'
import type {
  HandledRow,
  HandledStatus,
  ItemDecision,
  TickItemRow,
  TickRow,
  Verdict
} from '../../shared/api-types'
import { migrate } from './migrations'
import { RunStore } from './store-runs'
import { UsageStore } from './store-usage'
import { InboxStore } from './store-inbox'
import { QueueStore } from './store-queue'
import { ActionRunStore } from './store-actions'
import { DefinitionStore } from './store-definitions'
import { EventStore } from './store-events'
import { FieldCacheStore } from './store-fields'
import { AgentSessionStore } from './store-sessions'
import { MarkerStore } from './store-markers'
import { AdvanceStore } from './store-advance'

const DAY = 24 * 60 * 60_000
// Spec §7: ticks and their items are kept 30 days; runs and steps are kept indefinitely.
export const TICK_RETENTION_MS = 30 * DAY
// No tick runs this long: one still 'running' after an hour was cut off by a quit or a crash.
export const STUCK_TICK_MS = 60 * 60_000
export const INTERRUPTED = 'interrupted'

function toTick(r: Record<string, unknown>): TickRow {
  return {
    id: Number(r.id),
    automationId: String(r.automation_id),
    startedAt: Number(r.started_at),
    finishedAt: (r.finished_at as number | null) ?? null,
    dryRun: Number(r.dry_run) === 1,
    status: r.status as TickRow['status'],
    error: (r.error as string | null) ?? null,
    counts: JSON.parse(String(r.counts_json))
  }
}

export class PilotStore {
  readonly runs: RunStore
  readonly usage: UsageStore
  readonly inbox: InboxStore
  readonly queue: QueueStore
  readonly events: EventStore
  readonly actions: ActionRunStore
  readonly definitions: DefinitionStore
  readonly fields: FieldCacheStore
  readonly sessions: AgentSessionStore
  readonly markers: MarkerStore
  readonly advance: AdvanceStore

  private constructor(private readonly db: Database) {
    this.runs = new RunStore(db)
    this.inbox = new InboxStore(db)
    this.queue = new QueueStore(db)
    this.events = new EventStore(db)
    this.actions = new ActionRunStore(db)
    this.definitions = new DefinitionStore(db)
    this.fields = new FieldCacheStore(db)
    this.sessions = new AgentSessionStore(db)
    this.markers = new MarkerStore(db)
    this.advance = new AdvanceStore(db)
    this.usage = new UsageStore(db, this.advance)
  }

  static open(path: string): PilotStore {
    const db = new Database(path)
    try {
      // busy_timeout first: switching to WAL needs a lock another connection may briefly hold.
      db.pragma('busy_timeout = 5000')
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('foreign_keys = ON')
      migrate(db)
    } catch (error) {
      db.close()
      throw error
    }
    return new PilotStore(db)
  }

  close(): void {
    this.db.close()
  }

  // Run when Pilot starts. Each automation's newest tick of each kind (real, dry run) is kept at any
  // age, so the list still shows its last tick and the scheduler still knows when it last ran.
  // Deleting a tick deletes its items (ON DELETE CASCADE); its runs and steps stay.
  housekeep(now: number): { interrupted: number; pruned: number } {
    const interrupted = this.db
      .prepare(
        "UPDATE ticks SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running' AND started_at < ?"
      )
      .run(INTERRUPTED, now, now - STUCK_TICK_MS)
    const pruned = this.db
      .prepare(
        'DELETE FROM ticks WHERE started_at < ? AND id NOT IN (SELECT MAX(id) FROM ticks GROUP BY automation_id, dry_run)'
      )
      .run(now - TICK_RETENTION_MS)
    return { interrupted: Number(interrupted.changes), pruned: Number(pruned.changes) }
  }

  schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number
  }

  // Every write in `write` commits, or none does (an answer and its queue row, …). `write` is
  // synchronous and must not call recordDecisions, which opens its own transaction.
  transaction<T>(write: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = write()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  startTick(automationId: string, dryRun: boolean, at: number): number {
    const r = this.db
      .prepare('INSERT INTO ticks (automation_id, started_at, dry_run, status) VALUES (?, ?, ?, ?)')
      .run(automationId, at, dryRun ? 1 : 0, 'running')
    return Number(r.lastInsertRowid)
  }

  finishTick(
    tickId: number,
    status: 'ok' | 'failed',
    error: string | null,
    counts: Partial<Record<Verdict, number>>,
    at: number
  ): void {
    this.db
      .prepare(
        'UPDATE ticks SET status = ?, error = ?, counts_json = ?, finished_at = ? WHERE id = ?'
      )
      .run(status, error, JSON.stringify(counts), at, tickId)
  }

  recordDecisions(tickId: number, decisions: ItemDecision[], runIds: Map<string, string>): void {
    const insert = this.db.prepare(
      'INSERT INTO tick_items (tick_id, item_key, label, verdict, reason, checks_json, fields_json, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const d of decisions) {
        insert.run(
          tickId,
          d.key,
          d.label,
          d.verdict,
          d.reason,
          JSON.stringify(d.checks),
          JSON.stringify(d.fields),
          runIds.get(d.key) ?? null
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  lastTick(automationId: string): TickRow | null {
    const r = this.db
      .prepare('SELECT * FROM ticks WHERE automation_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(automationId)
    if (!r) {
      return null
    }
    return toTick(r as never)
  }

  // The scheduler's timing basis: a manual dry run must never push back the next real tick.
  lastRealTick(automationId: string): TickRow | null {
    const r = this.db
      .prepare(
        'SELECT * FROM ticks WHERE automation_id = ? AND dry_run = 0 ORDER BY started_at DESC LIMIT 1'
      )
      .get(automationId)
    if (!r) {
      return null
    }
    return toTick(r as never)
  }

  listTicks(automationId: string, limit: number): TickRow[] {
    return this.db
      .prepare('SELECT * FROM ticks WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(automationId, limit)
      .map((r) => toTick(r as never))
  }

  tickItems(tickId: number): TickItemRow[] {
    return this.db
      .prepare('SELECT * FROM tick_items WHERE tick_id = ? ORDER BY rowid')
      .all(tickId)
      .map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          tickId: Number(r.tick_id),
          itemKey: String(r.item_key),
          label: String(r.label),
          verdict: r.verdict as Verdict,
          reason: String(r.reason),
          checks: JSON.parse(String(r.checks_json)),
          fields: JSON.parse(String(r.fields_json)),
          runId: (r.run_id as string | null) ?? null
        }
      })
  }

  handledKeys(automationId: string): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT once_key FROM handled WHERE automation_id = ?')
        .all(automationId)
        .map((r) => String((r as { once_key: string }).once_key))
    )
  }

  markHandled(automationId: string, onceKey: string, runId: string | null, at: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO handled (automation_id, once_key, run_id, at) VALUES (?, ?, ?, ?)'
      )
      .run(automationId, onceKey, runId, at)
  }

  unmarkHandled(automationId: string, onceKey: string): void {
    this.db
      .prepare('DELETE FROM handled WHERE automation_id = ? AND once_key = ?')
      .run(automationId, onceKey)
  }

  // Frees the once_per key a run holds without knowing the key; a later run's re-mark is untouched.
  unmarkHandledForRun(automationId: string, runId: string): void {
    this.db
      .prepare('DELETE FROM handled WHERE automation_id = ? AND run_id = ?')
      .run(automationId, runId)
  }

  // retry_after_failure reads each key's status: a failed key is due again once its wait is over.
  handledRows(automationId: string): HandledRow[] {
    return this.db
      .prepare('SELECT * FROM handled WHERE automation_id = ? ORDER BY once_key')
      .all(automationId)
      .map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          onceKey: String(r.once_key),
          runId: (r.run_id as string | null) ?? null,
          at: Number(r.at),
          status: r.status as HandledStatus,
          failedAt: (r.failed_at as number | null) ?? null
        }
      })
  }

  // A run's end settles the key it holds; markHandled (INSERT OR REPLACE) starts a key over as 'started'.
  setHandledStatus(automationId: string, runId: string, status: HandledStatus, at: number): void {
    this.db
      .prepare(
        'UPDATE handled SET status = ?, failed_at = ? WHERE automation_id = ? AND run_id = ?'
      )
      .run(status, status === 'failed' ? at : null, automationId, runId)
  }

  seenKeys(automationId: string): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT item_key FROM seen WHERE automation_id = ?')
        .all(automationId)
        .map((r) => String((r as { item_key: string }).item_key))
    )
  }

  markSeen(automationId: string, itemKey: string, at: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO seen (automation_id, item_key, at) VALUES (?, ?, ?)')
      .run(automationId, itemKey, at)
  }

  // When each item was first seen: oldest_waiting_first's order for items whose source has no time.
  seenTimes(automationId: string): Map<string, number> {
    const rows = this.db
      .prepare('SELECT item_key, at FROM seen WHERE automation_id = ?')
      .all(automationId) as { item_key: string; at: number }[]
    return new Map(rows.map((r) => [String(r.item_key), Number(r.at)]))
  }
}
