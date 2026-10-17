import Database from '../../../../../main/sqlite/sync-database'
import type {
  HandledRow,
  HandledStatus,
  ItemDecision,
  ItemFields,
  TickItemRow,
  TickRow,
  Verdict
} from '../../shared/api-types'
import { worktreePathKey } from '../fields/agent-activity'
import { migrate } from './migrations'
import { ImportStore } from './store-import'
import { TimelineStore } from './store-timeline'
import { RunStore } from './store-runs'
import { UsageStore } from './store-usage'
import { SpendStore } from './store-spend'
import { InboxPreparationStore } from './store-inbox-preparations'
import { InboxStore } from './store-inbox'
import { QueueStore } from './store-queue'
import { ActionRunStore } from './store-actions'
import { DefinitionStore } from './store-definitions'
import { EventStore } from './store-events'
import { FieldCacheStore } from './store-fields'
import { AgentSessionStore } from './store-sessions'
import { MarkerStore } from './store-markers'
import { AdvanceStore } from './store-advance'
import { HandoverStore } from './store-handovers'
import { ActivityStore, QUIET_TICK, toTick } from './store-activity'
import { VisibilityStore } from './store-visibility'
import { CapacityStore } from './store-capacity'

const DAY = 24 * 60 * 60_000
// Spec §7: ticks and their items are kept 30 days; runs and steps are kept indefinitely.
export const TICK_RETENTION_MS = 30 * DAY
// No tick runs this long: one still 'running' after an hour was cut off by a quit or a crash.
export const STUCK_TICK_MS = 60 * 60_000
export const INTERRUPTED = 'interrupted'
// How long opening the store waits on a lock another process holds (an old Pilot still quitting).
export const STORE_BUSY_TIMEOUT_MS = 5_000
// Pilot's startup logs this, and the trace marks the services phase failed with it.
function storeOpenError(path: string, busyTimeoutMs: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return new Error(
      `${path} stayed locked for ${busyTimeoutMs / 1000}s; another process holds it (${message})`,
      { cause: error }
    )
  }
  return new Error(`${path} couldn't be opened: ${message}`, { cause: error })
}

// The worktree an item is about, in the one form the timeline reads it back in (worktreePathKey), so
// the index finds it however the path was spelled.
function worktreePathOf(fields: ItemFields): string | null {
  const path = fields['worktree.path']
  return typeof path === 'string' && path !== '' ? worktreePathKey(path) : null
}

export class PilotStore {
  readonly runs: RunStore
  readonly usage: UsageStore
  readonly spend: SpendStore
  readonly inboxPreparations: InboxPreparationStore
  readonly inbox: InboxStore
  readonly timeline: TimelineStore
  readonly queue: QueueStore
  readonly events: EventStore
  readonly actions: ActionRunStore
  readonly definitions: DefinitionStore
  readonly fields: FieldCacheStore
  readonly sessions: AgentSessionStore
  readonly markers: MarkerStore
  readonly advance: AdvanceStore
  readonly imports: ImportStore
  readonly handovers: HandoverStore
  readonly activity: ActivityStore
  readonly visibility: VisibilityStore
  readonly capacity: CapacityStore

  private constructor(private readonly db: Database) {
    this.runs = new RunStore(db)
    this.inbox = new InboxStore(db)
    this.inboxPreparations = new InboxPreparationStore(db, this.inbox)
    this.timeline = new TimelineStore(db, this.inbox)
    this.queue = new QueueStore(db)
    this.events = new EventStore(db)
    this.actions = new ActionRunStore(db)
    this.definitions = new DefinitionStore(db)
    this.fields = new FieldCacheStore(db)
    this.sessions = new AgentSessionStore(db)
    this.markers = new MarkerStore(db)
    this.advance = new AdvanceStore(db)
    this.imports = new ImportStore(db)
    this.usage = new UsageStore(db, this.advance)
    this.spend = new SpendStore(db)
    this.handovers = new HandoverStore(db)
    this.activity = new ActivityStore(db)
    this.visibility = new VisibilityStore(db)
    this.capacity = new CapacityStore(db)
  }

  static open(path: string, options: { busyTimeoutMs?: number } = {}): PilotStore {
    const busyTimeoutMs = options.busyTimeoutMs ?? STORE_BUSY_TIMEOUT_MS
    let db: Database
    try {
      // The connection's busy timeout covers every statement, the first PRAGMA and the migration too.
      db = new Database(path, { timeout: busyTimeoutMs })
    } catch (error) {
      throw storeOpenError(path, busyTimeoutMs, error)
    }
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('foreign_keys = ON')
      migrate(db)
    } catch (error) {
      db.close()
      throw storeOpenError(path, busyTimeoutMs, error)
    }
    return new PilotStore(db)
  }

  close(): void {
    this.db.close()
  }

  // Run when Pilot starts. Each automation's newest tick is kept at any age, so the list still shows its last tick
  // and the scheduler still knows when it last ran.
  // Deleting a tick deletes its items (ON DELETE CASCADE); its runs and steps stay.
  housekeep(now: number): { interrupted: number; pruned: number } {
    const interrupted = this.db
      .prepare(
        "UPDATE ticks SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running' AND started_at < ?"
      )
      .run(INTERRUPTED, now, now - STUCK_TICK_MS)
    const pruned = this.db
      .prepare(
        'DELETE FROM ticks WHERE started_at < ? AND id NOT IN (SELECT MAX(id) FROM ticks GROUP BY automation_id)'
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

  startTick(automationId: string, at: number): number {
    const r = this.db
      .prepare('INSERT INTO ticks (automation_id, started_at, status) VALUES (?, ?, ?)')
      .run(automationId, at, 'running')
    return Number(r.lastInsertRowid)
  }

  finishTick(
    tickId: number,
    status: 'ok' | 'failed',
    error: string | null,
    counts: Partial<Record<Verdict, number>>,
    at: number,
    warnings: readonly string[] = []
  ): void {
    this.db
      .prepare(
        'UPDATE ticks SET status = ?, error = ?, counts_json = ?, finished_at = ?, warnings_json = ? WHERE id = ?'
      )
      .run(status, error, JSON.stringify(counts), at, JSON.stringify(warnings), tickId)
  }

  recordDecisions(tickId: number, decisions: ItemDecision[], runIds: Map<string, string>): void {
    const insert = this.db.prepare(
      'INSERT INTO tick_items (tick_id, item_key, label, verdict, reason, checks_json, fields_json, run_id, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          runIds.get(d.key) ?? null,
          worktreePathOf(d.fields)
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // Also the scheduler's timing basis.
  lastTick(automationId: string): TickRow | null {
    const r = this.db
      .prepare('SELECT * FROM ticks WHERE automation_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(automationId)
    if (!r) {
      return null
    }
    return toTick(r as never)
  }

  // `skipQuiet`: leave out each tick that finished with nothing to do (QUIET_TICK); `limit` counts only those kept.
  listTicks(automationId: string, limit: number, skipQuiet = false): TickRow[] {
    const quiet = skipQuiet ? `AND NOT ${QUIET_TICK}` : ''
    return this.db
      .prepare(
        `SELECT * FROM ticks WHERE automation_id = ? ${quiet} ORDER BY started_at DESC LIMIT ?`
      )
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
