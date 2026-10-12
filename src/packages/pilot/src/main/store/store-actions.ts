import type Database from '../../../../../main/sqlite/sync-database'
import type { ActionPhase, ActionRunRow, ActionRunStatus } from '../../shared/api-types'

export type NewActionRun = Pick<
  ActionRunRow,
  'inboxItemId' | 'runId' | 'action' | 'args' | 'digest' | 'phase' | 'dryRun' | 'startedAt'
>

function toActionRun(r: Record<string, unknown>): ActionRunRow {
  return {
    id: Number(r.id),
    inboxItemId: (r.inbox_item_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    action: String(r.action),
    args: JSON.parse(String(r.args_json)) as Record<string, unknown>,
    digest: String(r.digest),
    phase: r.phase as ActionPhase,
    status: r.status as ActionRunStatus,
    output: (r.output as string | null) ?? null,
    dryRun: Number(r.dry_run) === 1,
    startedAt: Number(r.started_at),
    finishedAt: (r.finished_at as number | null) ?? null
  }
}

// Why an attempt a quit or a crash cut off was closed: it may or may not have done its effect.
export const ACTION_INTERRUPTED = 'interrupted: Pilot stopped while it ran'

// Every action attempt is a row (contract §10), refused ones included.
export class ActionRunStore {
  constructor(private readonly db: Database) {}

  start(a: NewActionRun): number {
    const r = this.db
      .prepare(
        "INSERT INTO action_runs (inbox_item_id, run_id, action, args_json, digest, phase, status, dry_run, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)"
      )
      .run(
        a.inboxItemId,
        a.runId,
        a.action,
        JSON.stringify(a.args),
        a.digest,
        a.phase,
        a.dryRun ? 1 : 0,
        a.startedAt
      )
    return Number(r.lastInsertRowid)
  }

  finish(
    id: number,
    status: Exclude<ActionRunStatus, 'running'>,
    output: string | null,
    at: number
  ): void {
    this.db
      .prepare('UPDATE action_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?')
      .run(status, output, at, id)
  }

  // At start: an attempt still 'running' from before this process was cut off. Left running, it would
  // block its card for ever (powers.ts cardToRun: "is already running"). Returns how many.
  interruptRunning(startedBefore: number, at: number): number {
    const output = JSON.stringify({
      outcome: 'failed',
      detail: ACTION_INTERRUPTED,
      link: null,
      log: null,
      onYou: false
    })
    const r = this.db
      .prepare(
        "UPDATE action_runs SET status = 'failed', output = ?, finished_at = ? WHERE status = 'running' AND started_at < ?"
      )
      .run(output, at, startedBefore)
    return Number(r.changes)
  }

  get(id: number): ActionRunRow | null {
    const r = this.db.prepare('SELECT * FROM action_runs WHERE id = ?').get(id)
    if (!r) {
      return null
    }
    return toActionRun(r as never)
  }

  forInboxItem(inboxItemId: string): ActionRunRow[] {
    return this.db
      .prepare('SELECT * FROM action_runs WHERE inbox_item_id = ? ORDER BY started_at, id')
      .all(inboxItemId)
      .map((r) => toActionRun(r as never))
  }

  forRun(runId: string): ActionRunRow[] {
    return this.db
      .prepare('SELECT * FROM action_runs WHERE run_id = ? ORDER BY started_at, id')
      .all(runId)
      .map((r) => toActionRun(r as never))
  }
}
