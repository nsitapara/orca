import type Database from '../../../../../main/sqlite/sync-database'
import type { InboxAnswer, InboxItemRow, InboxStatus } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { OUTCOME_PREFIX } from '../../shared/ticket-outcome'
import { fillSummaries, itemLabels } from './store-inbox-labels'
import { jsonOrNull, readCurrentDetails, readSnapshot, writeSnapshot } from './store-inbox-details'
import { INBOX_ROW_COLUMNS, toItem } from './store-inbox-row'

export type TicketedDoneRow = {
  id: string
  automationId: string
  itemKey: string
  title: string
  outcome: string
  updatedAt: number
}

export type NewInboxItem = Omit<
  InboxItemRow,
  | 'version'
  | 'status'
  | 'answer'
  | 'answeredAt'
  | 'answeredBy'
  | 'updatedAt'
  | 'outcome'
  | 'replies'
  | 'details'
> &
  Partial<Pick<InboxItemRow, 'outcome' | 'replies' | 'details'>>
// An edit is a new version of the card, so it always brings the new digest (contract §10).
export type InboxEdit = Partial<
  Pick<
    InboxItemRow,
    | 'type'
    | 'title'
    | 'context'
    | 'options'
    | 'suggested'
    | 'detailsMd'
    | 'details'
    | 'action'
    | 'actionArgs'
  >
> & { digest: string }
export type InboxFilter = Partial<{
  status: readonly InboxStatus[]
  person: string
  automationId: string
  // One value, or any of several (a run's ids, the spellings of a path).
  runId: string | readonly string[]
  itemKey: string
  worktreePath: string | readonly string[]
  source: InboxItemRow['source']
  // Rows touched at or after this time (`updated_at >= ?`).
  updatedSince: number
}>
// A change that is not a new version of the card: its status, how its work ended, who it is for.
export type InboxPatch = Partial<
  Pick<
    InboxItemRow,
    | 'status'
    | 'outcome'
    | 'replies'
    | 'person'
    | 'worktreePath'
    | 'suggested'
    | 'answer'
    | 'answeredAt'
    | 'answeredBy'
  >
>
// What saving an answer did. 'changed': the card moved on since the answer's digest was shown.
export type AnswerSave = 'saved' | 'changed' | 'closed' | 'missing'

const FILTER_COLUMNS = {
  person: 'person',
  automationId: 'automation_id',
  runId: 'run_id',
  itemKey: 'item_key',
  worktreePath: 'worktree_path',
  source: 'source'
} as const
const PATCH_COLUMNS: Record<keyof InboxPatch, string> = {
  status: 'status',
  outcome: 'outcome',
  replies: 'replies_json',
  person: 'person',
  worktreePath: 'worktree_path',
  suggested: 'suggested',
  answer: 'answer_json',
  answeredAt: 'answered_at',
  answeredBy: 'answered_by'
}
const EDIT_COLUMNS: Record<keyof InboxEdit, string> = {
  type: 'type',
  title: 'title',
  context: 'context',
  options: 'options_json',
  suggested: 'suggested',
  detailsMd: 'details_md',
  details: 'details_ref_json',
  action: 'action',
  actionArgs: 'action_args_json',
  digest: 'digest'
}

// replies and answer are stored as JSON text; null stays null.
function encodePatch(key: keyof InboxPatch, value: unknown): unknown {
  if ((key === 'replies' || key === 'answer') && value !== null) {
    return JSON.stringify(value)
  }
  return value
}

// JSON columns are stored as text; undefined keys are left out so they keep their value.
function encodeEdit(edit: InboxEdit): [string, unknown][] {
  return Object.entries(edit)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (key === 'options') {
        return [key, JSON.stringify(value)]
      }
      if (key === 'actionArgs' || key === 'details') {
        return [key, jsonOrNull(value)]
      }
      return [key, value]
    })
}

export class InboxStore {
  constructor(private readonly db: Database) {}

  // A card with a bundle is added with its snapshot, in the same row write.
  add(item: NewInboxItem, snapshot: DetailsSnapshot | null = null): void {
    this.db
      .prepare(
        `INSERT INTO inbox_items (id, automation_id, run_id, step_idx, item_key, worktree_path, person, type, title,
          context, options_json, suggested, details_md, action, action_args_json, digest, created_at, updated_at,
          outcome, replies_json, source, vault_ref, details_ref_json, details_snapshot_json, preparation_json, not_prepared_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.automationId,
        item.runId,
        item.stepIdx,
        item.itemKey,
        item.worktreePath,
        item.person,
        item.type,
        item.title,
        item.context,
        JSON.stringify(item.options),
        item.suggested,
        item.detailsMd,
        item.action,
        item.actionArgs === null ? null : JSON.stringify(item.actionArgs),
        item.digest,
        item.createdAt,
        item.createdAt,
        item.outcome ?? null,
        JSON.stringify(item.replies ?? []),
        item.source,
        item.vaultRef,
        jsonOrNull(item.details),
        jsonOrNull(snapshot),
        jsonOrNull(item.preparation),
        item.notPreparedKey ?? null
      )
  }

  get(id: string): InboxItemRow | null {
    const r = this.db.prepare(`SELECT ${INBOX_ROW_COLUMNS} FROM inbox_items WHERE id = ?`).get(id)
    if (!r) {
      return null
    }
    return toItem(r as never)
  }

  // Oldest first. Every filter given must hold; `status` matches any status it lists.
  list(filter: InboxFilter = {}): InboxItemRow[] {
    const where: string[] = []
    const values: unknown[] = []
    if (filter.status) {
      where.push('status IN (SELECT value FROM json_each(?))')
      values.push(JSON.stringify(filter.status))
    }
    for (const [key, column] of Object.entries(FILTER_COLUMNS)) {
      const value = filter[key as keyof typeof FILTER_COLUMNS]
      if (Array.isArray(value)) {
        where.push(`${column} IN (SELECT value FROM json_each(?))`)
        values.push(JSON.stringify(value))
      } else if (value !== undefined) {
        where.push(`${column} = ?`)
        values.push(value)
      }
    }
    if (filter.updatedSince !== undefined) {
      where.push('updated_at >= ?')
      values.push(filter.updatedSince)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    return this.db
      .prepare(`SELECT ${INBOX_ROW_COLUMNS} FROM inbox_items ${clause} ORDER BY created_at, id`)
      .all(...(values as never[]))
      .map((r) => toItem(r as never))
  }

  // The Details snapshot of a card's current version, or null when it has no bundle.
  snapshot(id: string): DetailsSnapshot | null {
    return readSnapshot(this.db, id)
  }

  // The digest and snapshot of the same version, read together (pilot.inbox.details and .image).
  currentDetails(id: string): { digest: string; snapshot: DetailsSnapshot | null } | null {
    return readCurrentDetails(this.db, id)
  }

  fillSummaries(): void {
    fillSummaries(this.db)
  }

  itemLabels(
    cards: { id: string; runId: string | null; automationId: string; itemKey: string | null }[]
  ): Map<string, string> {
    return itemLabels(this.db, cards)
  }

  // Done cards closed as ticketed for later, only the columns a match needs.
  ticketedDone(): TicketedDoneRow[] {
    return this.db
      .prepare(
        `SELECT id, automation_id, item_key, title, outcome, updated_at
           FROM inbox_items WHERE status = 'done' AND item_key IS NOT NULL AND outcome LIKE ?`
      )
      .all(`${OUTCOME_PREFIX}%`)
      .map((r) => ({
        id: String(r.id),
        automationId: String(r.automation_id),
        itemKey: String(r.item_key),
        title: String(r.title),
        outcome: String(r.outcome),
        updatedAt: Number(r.updated_at)
      }))
  }

  // The parsed args of the newest obsolete card for this action closed with this outcome prefix under this write id.
  closedWriteArgs(action: string, outcomePrefix: string, writeId: string): unknown {
    const r = this.db
      .prepare(
        `SELECT action_args_json FROM inbox_items
          WHERE status = 'obsolete' AND action = ? AND outcome LIKE ?
            AND json_extract(action_args_json, '$.write_id') = ?
          ORDER BY updated_at DESC, rowid DESC LIMIT 1`
      )
      .get(action, `${outcomePrefix}%`, writeId)
    const args: unknown = r?.action_args_json ? JSON.parse(String(r.action_args_json)) : null
    return args
  }

  setSnapshot(id: string, snapshot: DetailsSnapshot | null): void {
    writeSnapshot(this.db, id, snapshot)
  }

  edit(id: string, edit: InboxEdit, at: number): InboxItemRow | null {
    const entries = encodeEdit(edit)
    const sets = entries.map(([key]) => `${EDIT_COLUMNS[key as keyof InboxEdit]} = ?`)
    this.db
      .prepare(
        `UPDATE inbox_items SET ${[...sets, 'version = version + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`
      )
      .run(...(entries.map(([, value]) => value) as never[]), at, id)
    return this.get(id)
  }

  // Changes a card's status, outcome, replies or owner without making a new version (no digest change).
  update(id: string, patch: InboxPatch, at: number): void {
    const keys = (Object.keys(patch) as (keyof InboxPatch)[]).filter((k) => patch[k] !== undefined)
    const sets = [...keys.map((k) => `${PATCH_COLUMNS[k]} = ?`), 'updated_at = ?']
    if (patch.status && patch.status !== 'open') {
      sets.push(`preparation_json = CASE WHEN json_extract(preparation_json, '$.state') IN ('queued', 'generating', 'blocked')
        THEN json_set(preparation_json, '$.state', 'cancelled', '$.leaseUntil', NULL, '$.progress', 'Item answered or closed') ELSE preparation_json END`)
    }
    this.db
      .prepare(`UPDATE inbox_items SET ${sets.join(', ')} WHERE id = ?`)
      .run(...(keys.map((k) => encodePatch(k, patch[k])) as never[]), at, id)
  }

  // Saves only against the digest the card has now, and only while it is open (contract §10).
  saveAnswer(id: string, answer: InboxAnswer, by: string, at: number): AnswerSave {
    const r = this.db
      .prepare(
        `UPDATE inbox_items SET status = 'answered', answer_json = ?, answered_at = ?, answered_by = ?, updated_at = ?,
         preparation_json = CASE WHEN json_extract(preparation_json, '$.state') IN ('queued', 'generating', 'blocked')
           THEN json_set(preparation_json, '$.state', 'cancelled', '$.leaseUntil', NULL, '$.progress', 'Answered before context was ready') ELSE preparation_json END
         WHERE id = ? AND status = 'open' AND digest = ?`
      )
      .run(JSON.stringify(answer), at, by, at, id, answer.digest)
    if (Number(r.changes) > 0) {
      return 'saved'
    }
    const item = this.get(id)
    if (!item) {
      return 'missing'
    }
    if (item.status !== 'open') {
      return 'closed'
    }
    return 'changed'
  }

  setStatus(id: string, status: InboxStatus, at: number): boolean {
    const r = this.db
      .prepare(`UPDATE inbox_items SET status = ?, updated_at = ?,
        preparation_json = CASE WHEN ? != 'open' AND json_extract(preparation_json, '$.state') IN ('queued', 'generating', 'blocked')
          THEN json_set(preparation_json, '$.state', 'cancelled', '$.leaseUntil', NULL, '$.progress', 'Item closed') ELSE preparation_json END
        WHERE id = ?`)
      .run(status, at, status, id)
    return Number(r.changes) > 0
  }

  // A run that leaves open items ends needs_you (contract §7); a default the agent took never holds it.
  openCountForRun(runId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM inbox_items WHERE run_id = ? AND status = 'open' AND type != 'default'"
      )
      .get(runId)
    return Number((row as { n: number } | undefined)?.n ?? 0)
  }
}
