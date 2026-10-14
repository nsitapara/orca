import type Database from '../../../../../main/sqlite/sync-database'
import type { HandoverRow, HandoverState, TickTrigger, Verdict } from '../../shared/api-types'

const DAY_MS = 24 * 60 * 60_000
// A handover still pending this long expires (kept as expired, not deleted); settled rows are pruned after retention.
export const HANDOVER_EXPIRY_MS = 7 * DAY_MS
export const HANDOVER_RETENTION_MS = 30 * DAY_MS

export type NewHandover = {
  senderId: string
  senderRunId: string
  receiverId: string
  itemIds: readonly string[]
  at: number
}
// How the receiving tick settled one row: consumed with its item's verdict and run, or expired (dropped) with why.
export type HandoverResult = {
  rowId: number
  verdict: Verdict | null
  reason: string
  runId: string | null
  state?: 'consumed' | 'expired'
}
export const EXPIRED_AFTER = 'expired after 7 days'

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

  // The receiver's pending rows handed over since <notBefore>, oldest first; the rest wait for a later tick.
  pending(receiverId: string, limit: number, notBefore = 0): HandoverRow[] {
    return this.db
      .prepare(
        "SELECT * FROM handovers WHERE receiver_id = ? AND state = 'pending' AND created_at >= ? ORDER BY id LIMIT ?"
      )
      .all(receiverId, notBefore, limit)
      .map((r) => toHandover(r as never))
  }

  // What a tick reads: the receiver's pending rows not yet expired (handed over within HANDOVER_EXPIRY_MS of now).
  fresh(receiverId: string, limit: number, now: number): HandoverRow[] {
    return this.pending(receiverId, limit, now - HANDOVER_EXPIRY_MS)
  }

  // The rows a receiving run consumed go back to pending when that run fails: its next tick retries them (after
  // retry_after_failure). Returns how many.
  reopen(runId: string): number {
    const result = this.db
      .prepare(
        "UPDATE handovers SET state = 'pending', consumed_at = NULL, tick_id = NULL, verdict = NULL, reason = NULL, run_id = NULL WHERE run_id = ? AND state = 'consumed'"
      )
      .run(runId)
    return Number(result.changes)
  }

  // The receiver's rows pending since before <before> expire on the tick that found them. Returns how many.
  expire(receiverId: string, before: number, tickId: number, at: number): number {
    const result = this.db
      .prepare(
        "UPDATE handovers SET state = 'expired', consumed_at = ?, tick_id = ?, reason = ? WHERE receiver_id = ? AND state = 'pending' AND created_at < ?"
      )
      .run(at, tickId, EXPIRED_AFTER, receiverId, before)
    return Number(result.changes)
  }

  // The scheduler pass's housekeeping: rows pending longer than <expiryMs> expire with no tick (their receiver is off
  // or gone), and settled rows (consumed or expired) older than <retentionMs> are deleted.
  // Returns the rows it expired (for the receivers' Activity) and how many it pruned. Run it in a transaction.
  housekeep(
    now: number,
    expiryMs: number,
    retentionMs: number
  ): { expired: HandoverRow[]; pruned: number } {
    const stale = this.db
      .prepare("SELECT * FROM handovers WHERE state = 'pending' AND created_at < ? ORDER BY id")
      .all(now - expiryMs)
      .map((r) => toHandover(r as never))
    const expire = this.db.prepare(
      "UPDATE handovers SET state = 'expired', consumed_at = ?, reason = ? WHERE id = ?"
    )
    for (const h of stale) {
      expire.run(now, EXPIRED_AFTER, h.id)
    }
    const pruned = this.db
      .prepare("DELETE FROM handovers WHERE state != 'pending' AND consumed_at < ?")
      .run(now - retentionMs)
    const expired = stale.map((h) => ({
      ...h,
      state: 'expired' as const,
      consumedAt: now,
      reason: EXPIRED_AFTER
    }))
    return { expired, pruned: Number(pruned.changes) }
  }

  // The rows a tick read, each with how it decided the item. A row already consumed keeps its first record.
  // All or none: a tick's ids are consumed together.
  consume(tickId: number, at: number, results: readonly HandoverResult[]): void {
    const update = this.db.prepare(
      "UPDATE handovers SET state = ?, consumed_at = ?, tick_id = ?, verdict = ?, reason = ?, run_id = ? WHERE id = ? AND state = 'pending'"
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const r of results) {
        update.run(r.state ?? 'consumed', at, tickId, r.verdict, r.reason, r.runId, r.rowId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
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

  // The rows each of these ticks settled (consumed or expired), oldest first.
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

  // When the automation first ticked (of the ticks kept), or null: notes before it have no tick to sit under.
  firstTickAt(automationId: string): number | null {
    const row = this.db
      .prepare('SELECT MIN(started_at) AS at FROM ticks WHERE automation_id = ?')
      .get(automationId) as { at: number | null } | undefined
    return row?.at ?? null
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
