import { createHash } from 'node:crypto'
import type Database from '../../../../../main/sqlite/sync-database'
import type {
  ImportedDispatch,
  ImportedHandled,
  ImportedSeen,
  ImportedSession
} from '../../shared/api-types'

// Stable per (automation, terminal), so importing the same tab twice finds the first run.
export function importedRunId(automationId: string, terminalHandle: string): string {
  const hash = createHash('sha256').update(terminalHandle).digest('hex').slice(0, 12)
  return `import-${automationId}-${hash}`
}

function answerText(json: string | null): string | null {
  if (!json) {
    return null
  }
  try {
    const answer = JSON.parse(json) as { text?: unknown }
    return typeof answer.text === 'string' ? answer.text : null
  } catch {
    return null
  }
}

// pilot automations import-state's writes (Task 34a). Every one only adds: a row Pilot already holds is
// never replaced, so importing again right before cutover is safe.
export class ImportStore {
  constructor(private readonly db: Database) {}

  private batch<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  handledStatus(automationId: string, onceKey: string): string | null {
    const row = this.db
      .prepare('SELECT status FROM handled WHERE automation_id = ? AND once_key = ?')
      .get(automationId, onceKey) as { status: string } | undefined
    return row?.status ?? null
  }

  hasHandled(automationId: string, onceKey: string): boolean {
    return this.handledStatus(automationId, onceKey) !== null
  }

  // Never replaces a key Pilot already holds: a key one of Pilot's own runs wrote is newer.
  addHandled(automationId: string, rows: ImportedHandled[], at: number): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO handled (automation_id, once_key, run_id, at, status, failed_at)
       VALUES (?, ?, NULL, ?, ?, ?)`
    )
    return this.batch(() =>
      rows.reduce(
        (added, row) =>
          added +
          Number(
            insert.run(automationId, row.onceKey, row.at ?? at, row.status, row.failedAt ?? null)
              .changes
          ),
        0
      )
    )
  }

  hasSeen(automationId: string, itemKey: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS found FROM seen WHERE automation_id = ? AND item_key = ?')
        .get(automationId, itemKey)
    )
  }

  addSeen(automationId: string, rows: ImportedSeen[]): number {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO seen (automation_id, item_key, at) VALUES (?, ?, ?)'
    )
    return this.batch(() =>
      rows.reduce(
        (added, row) => added + Number(insert.run(automationId, row.itemKey, row.at).changes),
        0
      )
    )
  }

  hasSession(automationId: string, terminalHandle: string): boolean {
    const id = importedRunId(automationId, terminalHandle)
    return Boolean(this.db.prepare('SELECT 1 AS found FROM runs WHERE id = ?').get(id))
  }

  // A tab the old sweep opened, as a finished imported run whose step still names its terminal. The
  // session checks count it while that terminal is still open (store-runs sessionStepsIn). Its step is
  // stamped measured: the old sweep's tokens aren't Pilot's spend, so the usage reader never looks for them.
  addSession(automationId: string, s: ImportedSession, at: number): boolean {
    const id = importedRunId(automationId, s.terminalHandle)
    return this.batch(() => {
      const run = this.db
        .prepare(
          `INSERT OR IGNORE INTO runs (id, automation_id, tick_id, item_key, item_label, worktree_path, status, outcome,
             started_at, finished_at, trigger, imported)
           VALUES (?, ?, NULL, ?, ?, ?, 'done', 'Imported from the old sweep', ?, ?, 'import', 1)`
        )
        .run(id, automationId, `import:${s.worktreePath}`, s.label, s.worktreePath, at, at)
      const added = Number(run.changes) === 1
      if (added) {
        this.db
          .prepare(
            `INSERT INTO steps (run_id, idx, name, agent, skill, status, terminal_handle, started_at, finished_at, kind,
               usage_measured_at)
             VALUES (?, 0, 'imported', ?, NULL, 'done', ?, ?, ?, 'agent', ?)`
          )
          .run(id, s.agent, s.terminalHandle, at, at, at)
      }
      return added
    })
  }

  // The queue rows of the inbox items imported from <vaultRef> whose saved answer reads <answer>.
  private queueRowsFor(d: ImportedDispatch): { id: number; state: string }[] {
    const rows = this.db
      .prepare(
        `SELECT q.id AS id, q.state AS state, i.answer_json AS answer
         FROM inbox_items i JOIN queue q ON q.inbox_item_id = i.id WHERE i.vault_ref = ?`
      )
      .all(d.vaultRef) as { id: number; state: string; answer: string | null }[]
    return rows.filter((r) => answerText(r.answer) === d.answer)
  }

  isDispatched(d: ImportedDispatch): boolean {
    return this.queueRowsFor(d).some((r) => r.state === 'dispatched')
  }

  // Counts the pairs it marked. A pair whose card isn't imported yet, or whose answer differs, marks nothing.
  // Marking only ever stops a send: Pilot never sends an answer the old apply step already sent.
  markDispatched(rows: ImportedDispatch[], at: number): number {
    const mark = this.db.prepare(
      "UPDATE queue SET state = 'dispatched', hold_reason = NULL, updated_at = ? WHERE id = ?"
    )
    return this.batch(() => {
      let marked = 0
      for (const d of rows) {
        const waiting = this.queueRowsFor(d).filter((r) => r.state !== 'dispatched')
        for (const r of waiting) {
          mark.run(at, r.id)
        }
        marked += waiting.length > 0 ? 1 : 0
      }
      return marked
    })
  }
}
