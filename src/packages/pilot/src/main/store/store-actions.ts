import type Database from '../../../../../main/sqlite/sync-database'
import type { ActionPhase, ActionRunRow, ActionRunStatus } from '../../shared/api-types'

export type NewActionRun = Pick<
  ActionRunRow,
  'inboxItemId' | 'runId' | 'action' | 'args' | 'digest' | 'phase' | 'dryRun' | 'startedAt'
> & {
  // The process running it (this one unless said): main and orcad both open Pilot's store.
  writer?: number
}

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

function writerOf(output: string | null): number | null {
  try {
    const writer = (JSON.parse(output ?? 'null') as { writer?: unknown } | null)?.writer
    return typeof writer === 'number' ? writer : null
  } catch {
    return null
  }
}

// Whether the process that wrote a running row is gone. At start nothing here has run an action yet, so
// this process's own pid (reused from a dead one), or no pid recorded, is gone; otherwise a process with
// that pid exists unless the OS says there's none (EPERM: another user's, so alive). A reused pid reads
// as alive: the row stays running, never closed under a live writer.
export function writerGone(pid: number | null): boolean {
  if (pid === null || pid === process.pid) {
    return true
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'EPERM'
  }
}

// Every action attempt is a row (contract §10), refused ones included.
export class ActionRunStore {
  constructor(private readonly db: Database) {}

  start(a: NewActionRun): number {
    const r = this.db
      .prepare(
        "INSERT INTO action_runs (inbox_item_id, run_id, action, args_json, digest, phase, status, output, dry_run, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)"
      )
      .run(
        a.inboxItemId,
        a.runId,
        a.action,
        JSON.stringify(a.args),
        a.digest,
        a.phase,
        // While it runs, its output names the process running it; finish() replaces it.
        JSON.stringify({ writer: a.writer ?? process.pid }),
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

  // At start: attempts still 'running' whose process is gone (`writerGone(pid)`; null when no writer was
  // recorded) were cut off by a quit or a crash. Left running, each would block its card for ever
  // (powers.ts cardToRun: "is already running"); another live process's attempts are left alone.
  interruptRunning(
    startedBefore: number,
    at: number,
    writerGone: (pid: number | null) => boolean
  ): number {
    const output = JSON.stringify({
      outcome: 'failed',
      detail: ACTION_INTERRUPTED,
      link: null,
      log: null,
      onYou: false
    })
    const running = this.db
      .prepare("SELECT id, output FROM action_runs WHERE status = 'running' AND started_at < ?")
      .all(startedBefore) as { id: number; output: string | null }[]
    const close = this.db.prepare(
      "UPDATE action_runs SET status = 'failed', output = ?, finished_at = ? WHERE id = ? AND status = 'running'"
    )
    let closed = 0
    for (const row of running) {
      if (writerGone(writerOf(row.output))) {
        closed += Number(close.run(output, at, row.id).changes)
      }
    }
    return closed
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
