import type { InboxItemRow, InboxReply, QueueRow, RunRow } from '../../shared/api-types'
import { ANSWER_RUN_STOPPED } from '../../shared/pilot-replies'
import { oneLine } from '../inbox/card'
import { inboxEvent, syncRunWaiting } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'
import { PENDING_STATES } from '../store/store-queue'
import { hold } from './holds'

// Tries per answer: a dispatch that fails, or an answers session that doesn't finish.
export const MAX_ATTEMPTS = 3
const FINISHED_RUN: ReadonlySet<RunRow['status']> = new Set(['done', 'needs_you'])
export { ANSWER_RUN_STOPPED }

type Text = (key: string) => string

// Back to its person, its answer cleared (as save.ts clearAnswer), with a line under it when there is one:
// Pilot's own (the run was stopped) or the agent's (its `reply` output).
function reopen(
  store: PilotStore,
  item: InboxItemRow,
  line: InboxReply,
  kind: string,
  at: number
): void {
  const cleared = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
  const text = line.text
  store.inbox.update(
    item.id,
    { ...cleared, ...(text ? { replies: [...item.replies, line] } : {}) },
    at
  )
  if (text) {
    inboxEvent(store, item, kind, kind === 'item_reasked' ? { reason: text } : { text }, at)
  }
}

function retry(store: PilotStore, row: QueueRow, status: string, at: number): void {
  const attempts = row.attempts + 1
  const state = attempts >= MAX_ATTEMPTS ? 'failed' : 'held'
  const words = `the answers session ended ${status}`
  store.queue.update(row.id, { state, ...hold('retry', words), attempts }, at)
}

function settle(store: PilotStore, item: InboxItemRow, text: Text, at: number): void {
  const status = text('item_status')
  if (status === 'open') {
    reopen(store, item, { text: text('reply'), by: 'agent' }, 'item_replied', at)
    return
  }
  const outcome = text('outcome')
  const closed = status === 'stale' ? 'stale' : 'done'
  store.inbox.update(item.id, { status: closed, ...(outcome ? { outcome } : {}) }, at)
  inboxEvent(store, item, 'item_ticked', { status: closed, outcome }, at)
}

const PENDING: ReadonlySet<string> = new Set(PENDING_STATES)

// The card was answered again after this row was sent: the new answer has its own queue row (still
// pending, or sent to another run) and settles on its own, so this run's outcome must not touch the card.
function answeredAgain(store: PilotStore, item: InboxItemRow, row: QueueRow): boolean {
  if ((item.answeredAt ?? 0) > row.updatedAt) {
    return true
  }
  return store.queue.forInboxItem(item.id).some((r) => r.id !== row.id && PENDING.has(r.state))
}

// G6/E-19: an answer run reports back with the outputs `outcome` (one line), `item_status` (done | stale |
// open) and an optional `reply`. When it ends, every card it was sent for that is still 'answered' gets that
// status: done (the default) closes it, stale marks it stale, open puts it back to its person (answer
// cleared) with the reply under it. A card the agent already ticked, or Nish answered again after it was
// sent, is left alone. A run that failed or timed out queues its answers for another try (the
// dispatcher's usual three); one Nish stopped hands its cards back to him instead. Agent text is kept to one line. Wired as RunEngineDeps.onRunEnd.
export function answerRunEnded(store: PilotStore, run: RunRow): void {
  if (run.trigger !== 'answer') {
    return
  }
  const at = run.finishedAt ?? Date.now()
  const outputs = store.runs
    .steps(run.id)
    .reduce<Record<string, unknown>>((all, s) => ({ ...all, ...s.outputs }), {})
  const text: Text = (key) => (typeof outputs[key] === 'string' ? oneLine(outputs[key]) : '')
  for (const row of store.queue.forRun(run.id)) {
    const item = store.inbox.get(row.inboxItemId)
    if (row.state !== 'dispatched' || !item || item.status !== 'answered') {
      continue
    }
    if (answeredAgain(store, item, row)) {
      continue
    }
    if (run.status === 'cancelled') {
      reopen(store, item, { text: ANSWER_RUN_STOPPED, by: 'pilot' }, 'item_reasked', at)
    } else if (FINISHED_RUN.has(run.status)) {
      settle(store, item, text, at)
    } else {
      retry(store, row, run.status, at)
    }
    syncRunWaiting(store, item.runId, at)
  }
}
