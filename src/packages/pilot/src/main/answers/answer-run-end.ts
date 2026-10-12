import type { InboxItemRow, QueueRow, RunRow } from '../../shared/api-types'
import { oneLine } from '../inbox/card'
import { inboxEvent, syncRunWaiting } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'
import { hold } from './holds'

// Tries per answer: a dispatch that fails, or an answers session that doesn't finish.
export const MAX_ATTEMPTS = 3
const FINISHED_RUN: ReadonlySet<RunRow['status']> = new Set(['done', 'needs_you'])
export const ANSWER_RUN_STOPPED =
  'The answer run was stopped before it finished; answer again to send it.'

type Text = (key: string) => string

// Back to its person, its answer cleared (as save.ts clearAnswer), with a line under it when there is one.
function reopen(
  store: PilotStore,
  item: InboxItemRow,
  line: string,
  kind: string,
  at: number
): void {
  const cleared = { status: 'open' as const, answer: null, answeredAt: null, answeredBy: null }
  store.inbox.update(
    item.id,
    { ...cleared, ...(line ? { replies: [...item.replies, line] } : {}) },
    at
  )
  if (line) {
    inboxEvent(store, item, kind, kind === 'item_reasked' ? { reason: line } : { text: line }, at)
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
    reopen(store, item, text('reply'), 'item_replied', at)
    return
  }
  const outcome = text('outcome')
  const closed = status === 'stale' ? 'stale' : 'done'
  store.inbox.update(item.id, { status: closed, ...(outcome ? { outcome } : {}) }, at)
  inboxEvent(store, item, 'item_ticked', { status: closed, outcome }, at)
}

// G6/E-19: an answer run reports back with the outputs `outcome` (one line), `item_status` (done | stale |
// open) and an optional `reply`. When it ends, every card it was sent for that is still 'answered' gets that
// status: done (the default) closes it, stale marks it stale, open puts it back to its person (answer
// cleared) with the reply under it. A card the agent already ticked is left alone. A run that failed or
// timed out queues its answers for another try (the dispatcher's usual three); one Nish stopped hands its
// cards back to him instead. Agent text is kept to one line. Wired as RunEngineDeps.onRunEnd.
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
    if (run.status === 'cancelled') {
      reopen(store, item, ANSWER_RUN_STOPPED, 'item_reasked', at)
    } else if (FINISHED_RUN.has(run.status)) {
      settle(store, item, text, at)
    } else {
      retry(store, row, run.status, at)
    }
    syncRunWaiting(store, item.runId, at)
  }
}
