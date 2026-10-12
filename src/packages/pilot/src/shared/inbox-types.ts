import type { InboxItemRow, InboxStatus, InboxType } from './api-types'

// Waiting on you (contract §9-§10): the payloads of the inbox RPCs. Row types (InboxItemRow,
// InboxStatus, …) are in api-types.ts. Task 11b's CLI shells send these; Tasks 20c and 23b implement
// the RPCs. Tasks 20a and 23b append InboxItemSummary, QueueEntry and QueueListPayload below.

// Inside a run, runId and stepIdx come from the step's env; outside one, automationId and itemKey say
// whose card it is. `options` are the raw "<label> — <meaning>" strings (the server parses them).
export type InboxAddParams = {
  // The terminal the command ran in (ORCA_TERMINAL_HANDLE): the step starting or running on it is the
  // card's run step; runId/stepIdx below are only the fallback (ruling 8d).
  terminal?: string
  runId?: string
  stepIdx?: number
  automationId?: string
  itemKey?: string
  worktreePath?: string
  type: InboxType
  title: string
  context?: string
  suggested?: string
  options?: string[]
  detailsMd?: string
  action?: string
  actionArgs?: Record<string, unknown>
  // Parts of the card the person can approve or leave out one by one: id → label (H5).
  parts?: Record<string, string>
  // The words for a card's on/off switch: [on, off] (R-3).
  switchWords?: string[]
}
// id is null when the card was refused (the reason is in `refused`); existing = the same card was
// already waiting.
export type InboxAddResult = { id: string | null; existing: boolean; refused: string | null }
export type InboxListParams = { person?: string; statuses?: readonly InboxStatus[] }
export type InboxListPayload = {
  items: InboxItemRow[]
  people: { id: string; name: string }[]
  groups: { id: string; name: string; members: string[] }[]
  automations: { id: string; name: string }[]
}
// option is 0-based into the card's options (the CLI's --option <n> is 1-based and sends n - 1). Text
// wins over option. via 'page' names the digest of the version it showed.
export type InboxAnswerParams = {
  id: string
  option?: number
  text?: string
  digest?: string
  via?: 'page' | 'cli'
  by?: string
}

// What a timeline row shows of a card (F5): Task 30 imports it, Task 32's activity runs carry it.
export type InboxItemSummary = Pick<
  InboxItemRow,
  | 'id'
  | 'automationId'
  | 'runId'
  | 'stepIdx'
  | 'itemKey'
  | 'worktreePath'
  | 'person'
  | 'type'
  | 'title'
  | 'context'
  | 'status'
  | 'createdAt'
>
