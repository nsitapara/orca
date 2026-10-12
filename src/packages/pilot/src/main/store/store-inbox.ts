import type Database from '../../../../../main/sqlite/sync-database'
import type {
  InboxAnswer,
  InboxItemRow,
  InboxOption,
  InboxReply,
  InboxStatus,
  InboxType
} from '../../shared/api-types'

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
  | 'parts'
  | 'switchWords'
> &
  Partial<Pick<InboxItemRow, 'outcome' | 'replies' | 'parts' | 'switchWords'>>
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
    | 'action'
    | 'actionArgs'
    | 'parts'
    | 'switchWords'
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
  action: 'action',
  actionArgs: 'action_args_json',
  parts: 'parts_json',
  switchWords: 'switch_json',
  digest: 'digest'
}

function parsedOrNull(text: unknown): unknown {
  if (text === null || text === undefined) {
    return null
  }
  return JSON.parse(String(text))
}

function toItem(r: Record<string, unknown>): InboxItemRow {
  return {
    id: String(r.id),
    automationId: String(r.automation_id),
    runId: (r.run_id as string | null) ?? null,
    stepIdx: (r.step_idx as number | null) ?? null,
    itemKey: (r.item_key as string | null) ?? null,
    worktreePath: (r.worktree_path as string | null) ?? null,
    person: String(r.person),
    type: r.type as InboxType,
    title: String(r.title),
    context: String(r.context),
    options: JSON.parse(String(r.options_json)) as InboxOption[],
    suggested: (r.suggested as string | null) ?? null,
    detailsMd: (r.details_md as string | null) ?? null,
    action: (r.action as string | null) ?? null,
    actionArgs: parsedOrNull(r.action_args_json) as Record<string, unknown> | null,
    digest: String(r.digest),
    version: Number(r.version),
    status: r.status as InboxStatus,
    answer: parsedOrNull(r.answer_json) as InboxAnswer | null,
    answeredAt: (r.answered_at as number | null) ?? null,
    answeredBy: (r.answered_by as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    outcome: (r.outcome as string | null) ?? null,
    replies: repliesOf(r.replies_json),
    parts: JSON.parse(String(r.parts_json)) as Record<string, string>,
    switchWords: JSON.parse(String(r.switch_json)) as string[],
    source: r.source as InboxItemRow['source'],
    vaultRef: (r.vault_ref as string | null) ?? null
  }
}

// Only a stored { by: 'pilot' } reply is Pilot's. A plain string (written before authors were stored) or
// anything else reads as the agent's, so an old or odd row can never pass for Pilot.
function repliesOf(json: unknown): InboxReply[] {
  const stored: unknown = JSON.parse(String(json))
  if (!Array.isArray(stored)) {
    return []
  }
  return stored.map((r): InboxReply => {
    if (r && typeof r === 'object' && typeof (r as InboxReply).text === 'string') {
      const by = (r as InboxReply).by === 'pilot' ? 'pilot' : 'agent'
      return { text: (r as InboxReply).text, by }
    }
    return { text: String(r), by: 'agent' }
  })
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
      if (key === 'options' || key === 'parts' || key === 'switchWords') {
        return [key, JSON.stringify(value)]
      }
      if (key === 'actionArgs') {
        return [key, value === null ? null : JSON.stringify(value)]
      }
      return [key, value]
    })
}

export class InboxStore {
  constructor(private readonly db: Database) {}

  add(item: NewInboxItem): void {
    this.db
      .prepare(
        `INSERT INTO inbox_items (id, automation_id, run_id, step_idx, item_key, worktree_path, person, type, title,
          context, options_json, suggested, details_md, action, action_args_json, digest, created_at, updated_at,
          outcome, replies_json, parts_json, switch_json, source, vault_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        JSON.stringify(item.parts ?? {}),
        JSON.stringify(item.switchWords ?? []),
        item.source,
        item.vaultRef
      )
  }

  get(id: string): InboxItemRow | null {
    const r = this.db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id)
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
      .prepare(`SELECT * FROM inbox_items ${clause} ORDER BY created_at, id`)
      .all(...(values as never[]))
      .map((r) => toItem(r as never))
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
    this.db
      .prepare(`UPDATE inbox_items SET ${sets.join(', ')} WHERE id = ?`)
      .run(...(keys.map((k) => encodePatch(k, patch[k])) as never[]), at, id)
  }

  // Saves only against the digest the card has now, and only while it is open (contract §10).
  saveAnswer(id: string, answer: InboxAnswer, by: string, at: number): AnswerSave {
    const r = this.db
      .prepare(
        `UPDATE inbox_items SET status = 'answered', answer_json = ?, answered_at = ?, answered_by = ?, updated_at = ?
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
      .prepare('UPDATE inbox_items SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, at, id)
    return Number(r.changes) > 0
  }

  // A run that leaves open items ends needs_you (contract §7).
  openCountForRun(runId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE run_id = ? AND status = 'open'")
      .get(runId)
    return Number((row as { n: number } | undefined)?.n ?? 0)
  }
}
