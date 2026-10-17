import type Database from '../../../../../main/sqlite/sync-database'
import type { EventRow } from '../../shared/api-types'

export type NewEvent = {
  at: number
  kind: string
  automationId?: string | null
  runId?: string | null
  worktreePath?: string | null
  itemKey?: string | null
  payload?: Record<string, unknown>
}

export type EventFilter = {
  runId?: string
  automationId?: string
  kinds?: readonly string[]
  since?: number
  limit?: number
}

function toEvent(r: Record<string, unknown>): EventRow {
  return {
    id: Number(r.id),
    at: Number(r.at),
    automationId: (r.automation_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    worktreePath: (r.worktree_path as string | null) ?? null,
    itemKey: (r.item_key as string | null) ?? null,
    kind: String(r.kind),
    payload: JSON.parse(String(r.payload_json)) as Record<string, unknown>
  }
}

export class EventStore {
  constructor(private readonly db: Database) {}

  add(e: NewEvent): number {
    const r = this.db
      .prepare(
        'INSERT INTO events (at, automation_id, run_id, worktree_path, item_key, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        e.at,
        e.automationId ?? null,
        e.runId ?? null,
        e.worktreePath ?? null,
        e.itemKey ?? null,
        e.kind,
        JSON.stringify(e.payload ?? {})
      )
    return Number(r.lastInsertRowid)
  }

  // A run's story, in order.
  forRun(runId: string): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE run_id = ? ORDER BY at, id')
      .all(runId)
      .map((r) => toEvent(r as never))
  }

  // Newest first, back to `since`: what a worktree's timeline shows (contract §11).
  forWorktree(worktreePath: string, since: number): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE worktree_path = ? AND at >= ? ORDER BY at DESC, id DESC')
      .all(worktreePath, since)
      .map((r) => toEvent(r as never))
  }

  // These cards' events (inboxEvent names the card as payload.id) of these kinds, oldest first.
  forCards(ids: readonly string[], kinds: readonly string[]): EventRow[] {
    return this.db
      .prepare(
        "SELECT * FROM events WHERE kind IN (SELECT value FROM json_each(?)) AND json_extract(payload_json, '$.id') IN (SELECT value FROM json_each(?)) ORDER BY at, id"
      )
      .all(JSON.stringify(kinds), JSON.stringify(ids))
      .map((r) => toEvent(r as never))
  }

  // Oldest first. Every filter given must hold; `kinds` matches any kind it lists.
  list(filter: EventFilter): EventRow[] {
    const where: string[] = []
    const values: unknown[] = []
    if (filter.runId !== undefined) {
      where.push('run_id = ?')
      values.push(filter.runId)
    }
    if (filter.automationId !== undefined) {
      where.push('automation_id = ?')
      values.push(filter.automationId)
    }
    if (filter.kinds !== undefined) {
      where.push('kind IN (SELECT value FROM json_each(?))')
      values.push(JSON.stringify(filter.kinds))
    }
    if (filter.since !== undefined) {
      where.push('at >= ?')
      values.push(filter.since)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = filter.limit === undefined ? '' : ' LIMIT ?'
    if (filter.limit !== undefined) {
      values.push(filter.limit)
    }
    return this.db
      .prepare(`SELECT * FROM events ${clause} ORDER BY at, id${limit}`)
      .all(...(values as never[]))
      .map((r) => toEvent(r as never))
  }
}
