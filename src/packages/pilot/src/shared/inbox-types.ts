import type { HoldReason, InboxItemRow, InboxStatus, InboxType, QueueState } from './api-types'

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
// What an action card's Approve runs, as Pilot wrote it (printable ASCII), for the card version `digest`.
export type RunLine = { digest: string; text: string }
export type InboxListPayload = {
  items: InboxItemRow[]
  // An action card's Run line by card id (main/inbox/run-line.ts); none for other cards.
  runLines: Record<string, RunLine>
  people: { id: string; name: string }[]
  groups: { id: string; name: string; members: string[] }[]
  automations: { id: string; name: string }[]
}
// option is 0-based into the card's options (the CLI's --option <n> is 1-based and sends n - 1). Text
// wins over option. The desktop's save must name the digest of the version it showed. How it was given
// (page or device) and by which kind of caller come from the transport, never from params.
export type InboxAnswerParams = {
  id: string
  option?: number
  text?: string
  digest?: string
  // Recorded only: nothing may use it to authorize anything.
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

export type QueueHow = 'tick' | 'script' | 'agent' | 'revise' | 'reask'
export type QueueEntry = {
  rowId: number
  itemId: string
  title: string
  type: InboxType
  automationId: string
  automationName: string
  worktreePath: string | null
  person: string
  answer: string
  state: QueueState
  // Why it waits (R-c): the code and the plain words.
  holdReason: HoldReason | null
  holdDetail: string | null
  readyAt: number
  how: QueueHow
  fires: string
  updatedAt: number
}
export type QueueListPayload = { entries: QueueEntry[] }

// What one pass of the answers dispatcher did (`pilot.answers.applyNow`, `pilot inbox apply-now`).
export type DispatchReport = {
  retired: number
  ticked: number
  actions: number
  agents: number
  held: number
  reasked: number
}
