import type { HoldReason } from '../api-types'
import type { QueuedRun } from '../api-types-capacity'
import { formatDuration } from '../run/format-duration'

// How Running and the CLI read the runner's line and the keys it gave up on.

// Waiting on a slot: a capacity hold, or a row from an older Pilot that names none.
export function waitsForSlot(item: QueuedRun): boolean {
  return item.holdCode === undefined || item.holdCode === 'capacity'
}

// What frees a held row, said after its detail. Null where the detail already says when, and for the codes only the
// Inbox's queue holds on.
const HOLD_RELEASE: Record<HoldReason, string | null> = {
  in_flight:
    'It starts once the worktree is clean: changes committed or stashed, no rebase or merge running.',
  worktree_busy: 'It starts once nobody is typing or running an agent there.',
  typing: 'It starts once the typing stops.',
  session_open: 'It starts once that session is closed.',
  answers_pending: "It starts once they're applied.",
  quota: 'It starts once usage drops below that.',
  window: 'It starts when that window opens.',
  job_limit: "It starts when one of the job's runs ends.",
  no_worktree: 'It starts once the worktree exists.',
  retry: null,
  tick_limit: null,
  capacity: null,
  claimed: null,
  mr_unknown: null,
  waits: null
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

// Why a row waits and, for a hold, what frees it; null for a row from an older Pilot that says neither.
export function holdReasonText(item: QueuedRun): string | null {
  const detail = item.holdDetail ?? ''
  // A code from a newer Pilot has no entry here: its detail stands alone.
  const release = item.holdCode ? HOLD_RELEASE[item.holdCode] : null
  if (!release) {
    return detail || null
  }
  return detail ? `${sentence(detail)} ${release}` : release
}

// A slot waiter waits since it became due. A held row says how long the runner has held it, then how long ago it
// became due, which only earns its words when the two differ.
export function waitedText(item: QueuedRun, now: number): string {
  const due = formatDuration(now - (item.dueAt ?? item.queuedAt))
  if (waitsForSlot(item) || item.heldAt === undefined) {
    return `waiting ${due}`
  }
  const held = formatDuration(now - item.heldAt)
  if (held === due) {
    return `held ${held}`
  }
  return `held ${held} · ${item.dueFrom ?? 'due'} ${due} ago`
}

export function failedTimesText(failures: number): string {
  return failures === 1 ? 'failed 1 time' : `failed ${failures} times`
}
