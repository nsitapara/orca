import { InboxPreparationSchema } from '../../shared/preparation'
import type {
  InboxAnswer,
  InboxItemRow,
  InboxOption,
  InboxReply,
  InboxStatus,
  InboxType
} from '../../shared/api-types'
import { detailsRefOf } from './store-inbox-details'

// Every column a card row reads, without its Details snapshot: lists and gets stay light, and the
// snapshot is read only by id (pilot.inbox.details).
export const INBOX_ROW_COLUMNS = [
  'preparation_json',
  'not_prepared_key',
  'id',
  'automation_id',
  'run_id',
  'step_idx',
  'item_key',
  'worktree_path',
  'person',
  'type',
  'title',
  'context',
  'options_json',
  'suggested',
  'details_md',
  'details_ref_json',
  'action',
  'action_args_json',
  'digest',
  'version',
  'status',
  'answer_json',
  'answered_at',
  'answered_by',
  'created_at',
  'updated_at',
  'outcome',
  'replies_json',
  'source',
  'vault_ref'
].join(', ')

function parsedOrNull(text: unknown): unknown {
  if (text === null || text === undefined) {
    return null
  }
  return JSON.parse(String(text))
}

// A card row as stored (INBOX_ROW_COLUMNS) → InboxItemRow.
export function toItem(r: Record<string, unknown>): InboxItemRow {
  return {
    ...(r.preparation_json
      ? { preparation: InboxPreparationSchema.parse(parsedOrNull(r.preparation_json)) }
      : {}),
    ...(r.not_prepared_key ? { notPreparedKey: String(r.not_prepared_key) } : {}),
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
    details: detailsRefOf(r.details_ref_json),
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
