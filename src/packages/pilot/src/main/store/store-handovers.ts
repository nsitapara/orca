import type Database from '../../../../../main/sqlite/sync-database'
import type { HandoverRow, HandoverState, TickTrigger, Verdict } from '../../shared/api-types'

export type NewHandover = {
  senderId: string
  senderRunId: string
  receiverId: string
  itemIds: readonly string[]
  at: number
}
// How the receiving tick decided one row's item.
export type HandoverResult = {
  rowId: number
  verdict: Verdict | null
  reason: string
  runId: string | null
}

function toHandover(r: Record<string, unknown>): HandoverRow {
  return {
    id: Number(r.id),
    senderId: String(r.sender_id),
    senderRunId: String(r.sender_run_id),
    receiverId: String(r.receiver_id),
    itemId: String(r.item_id),
    createdAt: Number(r.created_at),
    state: r.state as HandoverState,
    consumedAt: (r.consumed_at as number | null) ?? null,
    tickId: (r.tick_id as number | null) ?? null,
    verdict: (r.verdict as Verdict | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null
  }
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

// The handovers table (V9) and the trigger a feed's run: now leaves on the tick it starts.
export class HandoverStore {
  constructor(private readonly db: Database) {}

  // Idempotent per (sender run, receiver, id): a repeat adds nothing. Returns the ids this call wrote.
  add(h: NewHandover): string[] {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO handovers (sender_id, sender_run_id, receiver_id, item_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const written: string[] = []
    for (const id of h.itemIds) {
      const result = insert.run(h.senderId, h.senderRunId, h.receiverId, id, h.at)
      if (Number(result.changes) > 0) {
        written.push(id)
      }
    }
    return written
  }

  // The receiver's pending rows, oldest first; the rest wait for a later tick.
  pending(receiverId: string, limit: number): HandoverRow[] {
    return this.db
      .prepare(
        "SELECT * FROM handovers WHERE receiver_id = ? AND state = 'pending' ORDER BY id LIMIT ?"
      )
      .all(receiverId, limit)
      .map((r) => toHandover(r as never))
  }

  // The rows a tick read, each with how it decided the item. A row already consumed keeps its first record.
  consume(tickId: number, at: number, results: readonly HandoverResult[]): void {
    const update = this.db.prepare(
      "UPDATE handovers SET state = 'consumed', consumed_at = ?, tick_id = ?, verdict = ?, reason = ?, run_id = ? WHERE id = ? AND state = 'pending'"
    )
    for (const r of results) {
      update.run(at, tickId, r.verdict, r.reason, r.runId, r.rowId)
    }
  }

  // The most recent handover from one stage to another: every row of the newest sender run that handed it ids.
  latest(senderId: string, receiverId: string): HandoverRow[] {
    return this.db
      .prepare(
        `SELECT * FROM handovers WHERE sender_id = ? AND receiver_id = ? AND sender_run_id = (
           SELECT sender_run_id FROM handovers WHERE sender_id = ? AND receiver_id = ? ORDER BY id DESC LIMIT 1)
         ORDER BY id`
      )
      .all(senderId, receiverId, senderId, receiverId)
      .map((r) => toHandover(r as never))
  }

  // The rows each of these ticks consumed, oldest first.
  consumedBy(tickIds: readonly number[]): Map<number, HandoverRow[]> {
    const found = new Map<number, HandoverRow[]>()
    if (tickIds.length === 0) {
      return found
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM handovers WHERE tick_id IN (${placeholders(tickIds.length)}) ORDER BY id`
      )
      .all(...tickIds)
      .map((r) => toHandover(r as never))
    for (const row of rows) {
      const tick = row.tickId as number
      found.set(tick, [...(found.get(tick) ?? []), row])
    }
    return found
  }

  setTickTrigger(tickId: number, trigger: TickTrigger): void {
    this.db
      .prepare('UPDATE ticks SET trigger_json = ? WHERE id = ?')
      .run(JSON.stringify(trigger), tickId)
  }

  tickTriggers(tickIds: readonly number[]): Map<number, TickTrigger> {
    if (tickIds.length === 0) {
      return new Map()
    }
    const rows = this.db
      .prepare(
        `SELECT id, trigger_json FROM ticks WHERE trigger_json IS NOT NULL AND id IN (${placeholders(tickIds.length)})`
      )
      .all(...tickIds) as { id: number; trigger_json: string }[]
    return new Map(rows.map((r) => [Number(r.id), JSON.parse(r.trigger_json) as TickTrigger]))
  }
}
