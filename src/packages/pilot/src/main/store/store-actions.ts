import { runProcessSync } from '@orca/process-host'
import type Database from '../../../../../main/sqlite/sync-database'
import type { ActionPhase, ActionRunRow, ActionRunStatus } from '../../shared/api-types'

export type NewActionRun = Pick<
  ActionRunRow,
  'inboxItemId' | 'runId' | 'action' | 'args' | 'digest' | 'phase' | 'dryRun' | 'startedAt'
> & {
  // The process running it (this one unless said): main and orcad both open Pilot's store.
  writer?: number
  // When that process started (processIdentity); this process's own when no writer is named.
  writerIdentity?: string
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

function writerOf(output: string | null): { pid: number | null; identity: string | null } {
  try {
    const parsed = JSON.parse(output ?? 'null') as { writer?: unknown; identity?: unknown } | null
    return {
      pid: typeof parsed?.writer === 'number' ? parsed.writer : null,
      identity: typeof parsed?.identity === 'string' ? parsed.identity : null
    }
  } catch {
    return { pid: null, identity: null }
  }
}

// When a process started, as `ps` prints it ("Mon Oct  5 09:00:00 2026"), or null when it can't be read.
// A pid alone is not an identity: the OS reuses pids, a reused one would read as the dead writer.
export function processIdentity(pid: number): string | null {
  try {
    const result = runProcessSync({
      program: 'ps',
      args: ['-o', 'lstart=', '-p', String(pid)],
      // ps prints lstart in local time: pin the zone so the same process always reads the same.
      env: { ...process.env, TZ: 'UTC' },
      timeoutMs: 2000
    })
    if (result.code !== 0 || result.timedOut) {
      return null
    }
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

// Read once, a failed read included, so a failing ps isn't run again on every start.
let ownIdentity: string | null | undefined
export function ownProcessIdentity(): string | null {
  if (ownIdentity === undefined) {
    ownIdentity = processIdentity(process.pid)
  }
  return ownIdentity
}

// Whether the process that wrote a running row is gone. At start nothing here has run an action yet, so
// this process's own pid (reused from a dead one), or no pid recorded, is gone; otherwise a process with
// that pid exists unless the OS says there's none (EPERM: another user's, so alive). A live pid whose
// start identity differs from the one recorded is a reused pid: the writer is gone. A row recorded
// without an identity, or an identity that can't be read now, reads as alive: never closed under a live
// writer.
export function writerGone(
  pid: number | null,
  identity: string | null = null,
  identityOf: (pid: number) => string | null = processIdentity
): boolean {
  if (pid === null || pid === process.pid) {
    return true
  }
  try {
    process.kill(pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'EPERM'
  }
  if (identity === null) {
    return false
  }
  const now = identityOf(pid)
  return now !== null && now !== identity
}

// What a running row's output says about the process running it.
function writerRecord(a: NewActionRun): { writer: number; identity?: string } {
  const identity = a.writer === undefined ? ownProcessIdentity() : (a.writerIdentity ?? null)
  return { writer: a.writer ?? process.pid, ...(identity ? { identity } : {}) }
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
        JSON.stringify(writerRecord(a)),
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

  // At start: attempts still 'running' whose process is gone (`writerGone(pid, identity)`; null when no writer was
  // recorded) were cut off by a quit or a crash. Left running, each would block its card for ever
  // (powers.ts cardToRun: "is already running"); another live process's attempts are left alone.
  interruptRunning(
    startedBefore: number,
    at: number,
    writerGone: (pid: number | null, identity: string | null) => boolean
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
      const writer = writerOf(row.output)
      if (writerGone(writer.pid, writer.identity)) {
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
