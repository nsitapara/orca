import type { PreparationInput } from './preparation'
import type {
  ActivityRun,
  HoldReason,
  InboxItemRow,
  InboxListRow,
  InboxReply,
  InboxStatus,
  InboxType,
  QueueState,
  RunStatus
} from './api-types'

// Inbox (contract §9-§10): the payloads of the inbox RPCs. Row types (InboxItemRow,
// InboxStatus, …) are in api-types.ts. Task 11b's CLI shells send these; Tasks 20c and 23b implement
// the RPCs. Tasks 20a and 23b append InboxItemSummary, QueueEntry and QueueListPayload below.

// Inside a run, runId and stepIdx come from the step's env; outside one, automationId and itemKey say
// whose card it is. `options` are the raw "<label> — <meaning>" strings (the server parses them).
export type InboxAddParams = {
  preparation?: PreparationInput
  // D2: a flagged notice for a card whose preparation request Pilot refused: no action, nothing runs from it, and
  // the prepared card for the same key retires it.
  notPrepared?: { key: string; reason: string }
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
  // A Details bundle (details.py) by its absolute path inside the Automations folder: Pilot's main
  // process reads and checks it, never the CLI. Not together with detailsMd.
  detailsBundlePath?: string
  action?: string
  actionArgs?: Record<string, unknown>
}
// id is null when the card was refused (the reason is in `refused`); existing = the same card was
// already waiting.
export type InboxAddResult = { id: string | null; existing: boolean; refused: string | null }
export type InboxListParams = { person?: string; statuses?: readonly InboxStatus[] }
// What an action card's Approve runs, as Pilot wrote it (printable ASCII), for the card version `digest`.
export type RunLine = { digest: string; text: string }
// Where an answered card's answer stands, from the server (the one lock rule, main/inbox/answer-lock.ts):
// `locked` means it may be being carried out and can't be undone; `state` is its newest queue row's (failed
// included, which the pending queue list never shows) and `reason` that row's words.
export type AnswerState = {
  locked: boolean
  // Its row was dispatched with no answer run (sent before Pilot took over): nothing to wait for or undo.
  sentBeforePilot: boolean
  state: QueueState | null
  readyAt: number | null
  reason: string | null
}
// A run a Message history line opens, and how it stands (null once the run is gone).
export type HistoryRun = { id: string; status: RunStatus | null }
// One line of a card's Message history (main/inbox/card-history.ts), oldest first. A reply with no event
// behind it (an imported card's) has no time.
export type CardHistoryEntry =
  | { kind: 'asked' | 'prepared'; at: number; run: HistoryRun | null }
  | {
      kind: 'answer'
      at: number
      text: string
      option: number | null
      run: HistoryRun | null
      // The titles of the other cards answered in the same run.
      with: string[]
    }
  | { kind: 'reply'; at: number | null; by: InboxReply['by']; text: string; run: HistoryRun | null }
export type PreparationWait = { code: HoldReason; detail: string; since: number }
export type InboxListPayload = {
  items: InboxListRow[]
  // An action card's Run line by card id (main/inbox/run-line.ts); none for other cards.
  runLines: Record<string, RunLine>
  // By card id, for each answered card.
  answerStates: Record<string, AnswerState>
  // Each card's run by run id, with its steps and cards, for the card's "From run" strip. Absent from older builds.
  runs?: Record<string, ActivityRun>
  // Each card's Message history by card id. Absent from older builds.
  history?: Record<string, CardHistoryEntry[]>
  // Why each queued context card waits, by card id: the runner line's hold. Absent from older builds.
  preparationWaits?: Record<string, PreparationWait>
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
