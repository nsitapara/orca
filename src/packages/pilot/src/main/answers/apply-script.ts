import type { InboxItemRow } from '../../shared/api-types'
import { evidenceGate } from '../../shared/evidence'
import { attemptAction, type AttemptDeps } from '../actions/attempt'
import { actionFailed, type ActionResult } from '../actions/types'
import { reaskInboxItem, resolveInboxItem, type InboxDeps } from '../inbox/inbox-service'
import { CARD_CHANGED, INTERRUPTED_AGAIN } from '../../shared/pilot-replies'
import { ACTION_INTERRUPTED } from '../store/store-actions'
import { APPROVE_ON_DESKTOP } from './queue-view'

// apply.py CARD_CHANGED. An approval from anywhere but Pilot's desktop app is re-asked with APPROVE_ON_DESKTOP
// (apply.py's PAGE_ONLY, under the desktop-only ruling).
export { CARD_CHANGED, INTERRUPTED_AGAIN }

export type ScriptStep =
  | { kind: 'done' }
  | { kind: 'reasked' }
  | { kind: 'waits'; reason: string }
  | { kind: 'agent'; note: string }
export type ScriptDeps = { inbox: InboxDeps; attempt: AttemptDeps }

// apply.py _outcome: "<outcome>: <detail> · <link>", and the log when it failed.
export function outcomeText(result: ActionResult): string {
  const head = result.detail ? `${result.outcome}: ${result.detail}` : result.outcome
  const link = result.link ? ` · ${result.link}` : ''
  const log = result.outcome === 'failed' && result.log ? ` · log ${result.log}` : ''
  return head + link + log
}

// apply.py off_outcome + _parts_summary: "done: 1 done · 1 left out" (a Keep switch records `kept`).
export function partsOutcome(item: InboxItemRow, result: ActionResult, leaveOut: string[]): string {
  const off = (item.switchWords[1] ?? 'Leave out').toLowerCase() === 'keep' ? 'kept' : 'left out'
  const counts = new Map<string, number>()
  for (const id of Object.keys(item.parts)) {
    const word = leaveOut.includes(id) ? off : result.outcome
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return `${result.outcome}: ${[...counts].map(([word, n]) => `${n} ${word}`).join(' · ')}`
}

function interruptedOutput(output: string | null): boolean {
  try {
    return (
      (JSON.parse(output ?? 'null') as { detail?: unknown } | null)?.detail === ACTION_INTERRUPTED
    )
  } catch {
    return false
  }
}

// A stop cut off this card's action after this answer approved it: whether it happened isn't known.
function interruptedSinceApproval(deps: ScriptDeps, item: InboxItemRow): boolean {
  const since = item.answeredAt ?? 0
  return deps.attempt.store.actions
    .forInboxItem(item.id)
    .some(
      (r) =>
        r.phase === 'do' &&
        !r.dryRun &&
        r.status === 'failed' &&
        r.startedAt >= since &&
        interruptedOutput(r.output)
    )
}

// Why an approval can't run now, or null. Checked on the card as just re-read, with nothing awaited
// between the check and the attempt: only Pilot's desktop app approves, and only the version it saw.
function approvalProblem(deps: ScriptDeps, item: InboxItemRow): string | null {
  const gate = evidenceGate(item)
  if (gate) {
    return gate
  }
  if (item.answer?.callerKind !== 'desktop') {
    return APPROVE_ON_DESKTOP
  }
  if (item.answer.digest !== item.digest) {
    return CARD_CHANGED
  }
  return interruptedSinceApproval(deps, item) ? INTERRUPTED_AGAIN : null
}

// An approved action (apply.py _apply_item's script branch), run only through the card path: the
// catalog entry runs the card's own pinned args, re-read and re-checked by attemptAction (powers.ts
// cardToRun), less the parts left out; the digest is the one the answer approved. Never any other args.
export async function applyScript(
  deps: ScriptDeps,
  item: InboxItemRow,
  leaveOut: string[]
): Promise<ScriptStep> {
  const problem = approvalProblem(deps, item)
  if (problem || !item.answer) {
    reaskInboxItem(deps.inbox, item.id, problem ?? APPROVE_ON_DESKTOP)
    return { kind: 'reasked' }
  }
  const action = item.action ?? ''
  const attempted = await attemptAction(deps.attempt, {
    action,
    approved: true,
    inboxItemId: item.id,
    runId: item.runId,
    digest: item.answer.digest,
    leftOut: leaveOut,
    dryRun: false
  })
  // A card attempt never asks; were it to, nothing ran.
  const result = attempted.outcome === 'asked' ? actionFailed(attempted.detail) : attempted
  const parts = Object.keys(item.parts).length > 0
  // A push pilotcli skipped (spec E): the card stays open with why it wasn't pushed.
  if (result.outcome === 'stale' && result.keepOpen && !parts) {
    reaskInboxItem(deps.inbox, item.id, result.detail)
    return { kind: 'reasked' }
  }
  if (result.outcome === 'not_yet' && !parts) {
    return { kind: 'waits', reason: result.detail + (result.onYou ? ' (waits on you)' : '') }
  }
  if (result.outcome === 'needs_agent') {
    return { kind: 'agent', note: result.detail }
  }
  const outcome = parts ? partsOutcome(item, result, leaveOut) : outcomeText(result)
  resolveInboxItem(deps.inbox, item.id, outcome)
  return { kind: 'done' }
}
