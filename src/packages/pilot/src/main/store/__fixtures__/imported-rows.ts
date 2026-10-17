import { createHash } from 'node:crypto'
import type { PilotStore } from '../store'

// Tests only: rows shaped as the retired `pilot automations import-state` wrote them (an old sweep's state, brought in
// before each job went live). Pilot still reads the ones in its database: a handled key no run holds, and a finished
// imported run whose step names the old sweep's terminal.
type Db = { prepare(sql: string): { run(...params: unknown[]): { changes: number | bigint } } }

function dbOf(store: PilotStore): Db {
  return (store as unknown as { db: Db }).db
}

export type ImportedHandled = {
  onceKey: string
  status: 'started' | 'done' | 'failed'
  at: number
  failedAt?: number | null
}

export type ImportedSession = {
  worktreePath: string
  terminalHandle: string
  agent: 'claude' | 'codex'
  label: string
}

// Never replaces a key the store already holds, as the import didn't: the first row for a key wins.
export function addImportedHandled(
  store: PilotStore,
  automationId: string,
  rows: readonly ImportedHandled[]
): void {
  const insert = dbOf(store).prepare(
    `INSERT OR IGNORE INTO handled (automation_id, once_key, run_id, at, status, failed_at)
     VALUES (?, ?, NULL, ?, ?, ?)`
  )
  for (const row of rows) {
    insert.run(automationId, row.onceKey, row.at, row.status, row.failedAt ?? null)
  }
}

// A tab the old sweep opened: a finished imported run whose one step still names its terminal.
export function addImportedSession(
  store: PilotStore,
  automationId: string,
  s: ImportedSession,
  at: number
): void {
  const id = `import-${automationId}-${createHash('sha256').update(s.terminalHandle).digest('hex').slice(0, 12)}`
  const db = dbOf(store)
  const run = db
    .prepare(
      `INSERT OR IGNORE INTO runs (id, automation_id, tick_id, item_key, item_label, worktree_path, status, outcome,
         started_at, finished_at, trigger, imported)
       VALUES (?, ?, NULL, ?, ?, ?, 'done', 'Imported from the old sweep', ?, ?, 'import', 1)`
    )
    .run(id, automationId, `import:${s.worktreePath}`, s.label, s.worktreePath, at, at)
  if (Number(run.changes) !== 1) {
    return
  }
  db.prepare(
    `INSERT INTO steps (run_id, idx, name, agent, skill, status, terminal_handle, started_at, finished_at, kind,
       usage_measured_at)
     VALUES (?, 0, 'imported', ?, NULL, 'done', ?, ?, ?, 'agent', ?)`
  ).run(id, s.agent, s.terminalHandle, at, at, at)
}
