import type Database from '../../../../../main/sqlite/sync-database'
import type { HoldReason, QueueRoute, QueueRow, QueueState } from '../../shared/api-types'

export type QueuePatch = Partial<
  Pick<
    QueueRow,
    | 'state'
    | 'holdReason'
    | 'holdDetail'
    | 'readyAt'
    | 'attempts'
    | 'route'
    | 'targetSessionId'
    | 'dispatchedRunId'
  >
>

export const PENDING_STATES = ['not_ready', 'ready', 'held'] as const
// holdReason and holdDetail share the hold_reason column, stored as "<code>: <words>".
const QUEUE_COLUMNS: Record<Exclude<keyof QueuePatch, 'holdReason' | 'holdDetail'>, string> = {
  state: 'state',
  readyAt: 'ready_at',
  attempts: 'attempts',
  route: 'route',
  targetSessionId: 'target_session_id',
  dispatchedRunId: 'dispatched_run_id'
}

// Splits at the first ': ', so the words may contain colons.
function splitHold(text: unknown): Pick<QueueRow, 'holdReason' | 'holdDetail'> {
  if (text === null || text === undefined) {
    return { holdReason: null, holdDetail: null }
  }
  const stored = String(text)
  const at = stored.indexOf(': ')
  if (at === -1) {
    return { holdReason: stored as HoldReason, holdDetail: null }
  }
  return { holdReason: stored.slice(0, at) as HoldReason, holdDetail: stored.slice(at + 2) }
}

function joinHold(reason: HoldReason | null, detail: string | null): string | null {
  if (reason === null) {
    return null
  }
  return detail === null ? reason : `${reason}: ${detail}`
}

function toQueueRow(r: Record<string, unknown>): QueueRow {
  return {
    id: Number(r.id),
    inboxItemId: String(r.inbox_item_id),
    state: r.state as QueueState,
    ...splitHold(r.hold_reason),
    readyAt: Number(r.ready_at),
    attempts: Number(r.attempts),
    route: (r.route as QueueRoute | null) ?? null,
    targetSessionId: (r.target_session_id as string | null) ?? null,
    dispatchedRunId: (r.dispatched_run_id as string | null) ?? null,
    updatedAt: Number(r.updated_at)
  }
}

function holdDetailFor(patch: QueuePatch, current: QueueRow | null): string | null {
  if (patch.holdDetail !== undefined) {
    return patch.holdDetail
  }
  // A new reason without a detail clears the old words.
  return patch.holdReason === undefined ? (current?.holdDetail ?? null) : null
}

export class QueueStore {
  constructor(private readonly db: Database) {}

  // A saved answer waits not_ready until readyAt, its settle time (contract §10).
  enqueue(inboxItemId: string, readyAt: number, at: number): number {
    const r = this.db
      .prepare(
        "INSERT INTO queue (inbox_item_id, state, ready_at, updated_at) VALUES (?, 'not_ready', ?, ?)"
      )
      .run(inboxItemId, readyAt, at)
    return Number(r.lastInsertRowid)
  }

  get(id: number): QueueRow | null {
    const r = this.db.prepare('SELECT * FROM queue WHERE id = ?').get(id)
    if (!r) {
      return null
    }
    return toQueueRow(r as never)
  }

  forInboxItem(inboxItemId: string): QueueRow[] {
    return this.db
      .prepare('SELECT * FROM queue WHERE inbox_item_id = ? ORDER BY id')
      .all(inboxItemId)
      .map((r) => toQueueRow(r as never))
  }

  // Every row of each of these items, in one query.
  forItems(inboxItemIds: string[]): Map<string, QueueRow[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM queue WHERE inbox_item_id IN (SELECT value FROM json_each(?)) ORDER BY id'
      )
      .all(JSON.stringify(inboxItemIds))
      .map((r) => toQueueRow(r as never))
    const byItem = new Map<string, QueueRow[]>()
    for (const r of rows) {
      byItem.set(r.inboxItemId, [...(byItem.get(r.inboxItemId) ?? []), r])
    }
    return byItem
  }

  // What the dispatcher looks at each pass: rows not yet dispatched or failed, earliest ready first.
  pending(): QueueRow[] {
    return this.db
      .prepare(
        "SELECT * FROM queue WHERE state IN ('not_ready', 'ready', 'held') ORDER BY ready_at, id"
      )
      .all()
      .map((r) => toQueueRow(r as never))
  }

  // The rows an answer run was sent (answerRunEnded): one run's, not the whole history.
  forRun(runId: string): QueueRow[] {
    return this.db
      .prepare('SELECT * FROM queue WHERE dispatched_run_id = ? ORDER BY id')
      .all(runId)
      .map((r) => toQueueRow(r as never))
  }

  // A patch that names holdReason or holdDetail rewrites the one hold_reason column: a new reason
  // without a detail clears the old words, a detail alone keeps the current reason.
  update(id: number, patch: QueuePatch, at: number): void {
    const keys = (Object.keys(patch) as (keyof QueuePatch)[])
      .filter((k) => patch[k] !== undefined)
      .filter((k): k is keyof typeof QUEUE_COLUMNS => k !== 'holdReason' && k !== 'holdDetail')
    const sets = keys.map((k) => `${QUEUE_COLUMNS[k]} = ?`)
    const values: unknown[] = keys.map((k) => patch[k] ?? null)
    if (patch.holdReason !== undefined || patch.holdDetail !== undefined) {
      const current = this.get(id)
      const reason =
        patch.holdReason === undefined ? (current?.holdReason ?? null) : patch.holdReason
      const detail = holdDetailFor(patch, current)
      sets.push('hold_reason = ?')
      values.push(joinHold(reason, detail))
    }
    this.db
      .prepare(`UPDATE queue SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`)
      .run(...(values as never[]), at, id)
  }

  // Rows in any of `states`, earliest ready first.
  list(states: readonly QueueState[]): QueueRow[] {
    return this.db
      .prepare(
        'SELECT * FROM queue WHERE state IN (SELECT value FROM json_each(?)) ORDER BY ready_at, id'
      )
      .all(JSON.stringify(states))
      .map((r) => toQueueRow(r as never))
  }

  // An item whose card went away or changed has nothing left to dispatch.
  removePending(inboxItemId: string): number {
    const r = this.db
      .prepare(
        `DELETE FROM queue WHERE inbox_item_id = ? AND state IN (${PENDING_STATES.map((s) => `'${s}'`).join(', ')})`
      )
      .run(inboxItemId)
    return Number(r.changes)
  }

  // The items of this automation on this item with an answer saved but not yet dispatched
  // (H1's `inbox.pending_answers`).
  pendingAnswerCount(automationId: string, itemKey: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT i.id) AS n FROM queue q JOIN inbox_items i ON i.id = q.inbox_item_id
         WHERE i.automation_id = ? AND i.item_key = ? AND q.state IN (${PENDING_STATES.map((s) => `'${s}'`).join(', ')})`
      )
      .get(automationId, itemKey)
    return Number((row as { n: number } | undefined)?.n ?? 0)
  }

  // One dispatch per worktree at a time (contract §10). True when `holder` holds the claim now:
  // it was free, had run out, or was already this holder's (which renews it).
  claim(worktreePath: string, holder: string, until: number, now: number): boolean {
    const r = this.db
      .prepare(
        `INSERT INTO claims (worktree_path, holder, until) VALUES (?, ?, ?)
         ON CONFLICT(worktree_path) DO UPDATE SET holder = excluded.holder, until = excluded.until
         WHERE claims.until <= ? OR claims.holder = excluded.holder`
      )
      .run(worktreePath, holder, until, now)
    return Number(r.changes) > 0
  }

  release(worktreePath: string, holder: string): void {
    this.db
      .prepare('DELETE FROM claims WHERE worktree_path = ? AND holder = ?')
      .run(worktreePath, holder)
  }

  claimHolder(worktreePath: string, now: number): string | null {
    const r = this.db
      .prepare('SELECT holder FROM claims WHERE worktree_path = ? AND until > ?')
      .get(worktreePath, now)
    return r ? String(r.holder) : null
  }
}
