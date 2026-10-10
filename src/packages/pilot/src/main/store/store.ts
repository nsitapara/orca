import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision, TickItemRow, TickRow, Verdict } from '../../shared/api-types'
import { migrate } from './migrations'
import { RunStore } from './store-runs'

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

  private constructor(private readonly db: Database) {
    this.runs = new RunStore(db)
  }

  static open(path: string): PilotStore {
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    migrate(db)
    return new PilotStore(db)
  }

  close(): void {
    this.db.close()
  }

  schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number
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
}
