import type { EventRow, InboxItemRow } from '../../shared/api-types'
import type { CardHistoryEntry, HistoryRun } from '../../shared/inbox-types'
import type { PilotStore } from '../store/store'

type Answer = Extract<CardHistoryEntry, { kind: 'answer' }>
// Where a stored reply was added; filled with its words once every event is read.
type Slot = { kind: 'slot'; at: number; run: HistoryRun | null }
type Line = Exclude<CardHistoryEntry, { kind: 'reply' }> | Slot
type Lookups = {
  run(id: string | null): HistoryRun | null
  answeredWith(runId: string, itemId: string): string[]
}

const KINDS = [
  'answer_saved',
  'answer_cleared',
  'answer_sent',
  'item_replied',
  'item_reasked',
  'item_updated'
]

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const isContextReady = (e: EventRow): boolean =>
  e.kind === 'item_updated' && e.payload.reason === 'context_ready'

function lookups(store: PilotStore): Lookups {
  return {
    run: (id) => (id ? { id, status: store.runs.get(id)?.status ?? null } : null),
    answeredWith: (runId, itemId) => {
      const sent = store.events.list({ runId, kinds: ['answer_run'], limit: 1 })[0]
      const ids = Array.isArray(sent?.payload.items) ? sent.payload.items : []
      return ids.flatMap((id) => {
        const title = typeof id === 'string' && id !== itemId ? store.inbox.get(id)?.title : null
        return title ? [title] : []
      })
    }
  }
}

// The stored replies are the words; the events say when each was added. Replies fill the newest slots, and any with
// no event behind them (an imported card's) lead, untimed, after the ask.
function withReplies(lines: Line[], replies: InboxItemRow['replies']): CardHistoryEntry[] {
  const slots = lines.filter((l) => l.kind === 'slot').length
  const filled = Math.min(slots, replies.length)
  const lead = replies.length - filled
  let n = -(slots - filled)
  const out = lines.flatMap((line): CardHistoryEntry[] => {
    if (line.kind !== 'slot') {
      return [line]
    }
    const reply = n >= 0 ? replies[lead + n] : undefined
    n += 1
    return reply ? [{ kind: 'reply', at: line.at, ...reply, run: line.run }] : []
  })
  const untimed = replies
    .slice(0, lead)
    .map((r): CardHistoryEntry => ({ kind: 'reply', at: null, ...r, run: null }))
  return [...out.slice(0, 1), ...untimed, ...out.slice(1)]
}

function historyOf(item: InboxItemRow, events: EventRow[], look: Lookups): CardHistoryEntry[] {
  const lines: Line[] = [{ kind: 'asked', at: item.createdAt, run: look.run(item.runId) }]
  if (item.notPreparedKey) {
    lines.push({ kind: 'slot', at: item.createdAt, run: null })
  }
  const lastReady = events.findLast(isContextReady)
  // The answer not yet sent, and the run the latest one went to (an agent's reply after it comes from there).
  const state: { pending: Answer | null; answeredIn: HistoryRun | null } = {
    pending: null,
    answeredIn: null
  }
  const commit = (): void => {
    if (state.pending) {
      lines.push(state.pending)
      state.answeredIn = state.pending.run
      state.pending = null
    }
  }
  for (const e of events) {
    if (e.kind === 'answer_saved') {
      const option = typeof e.payload.option === 'number' ? e.payload.option : null
      const text = str(e.payload.text) ?? ''
      state.pending = { kind: 'answer', at: e.at, text, option, run: null, with: [] }
    } else if (e.kind === 'answer_cleared') {
      state.pending = null
    } else if (e.kind === 'answer_sent') {
      const runId = str(e.payload.runId)
      if (state.pending && runId) {
        const went = { run: look.run(runId), with: look.answeredWith(runId, item.id) }
        state.pending = { ...state.pending, ...went }
      }
      commit()
    } else if (e.kind === 'item_replied' || e.kind === 'item_reasked') {
      commit()
      lines.push({ kind: 'slot', at: e.at, run: state.answeredIn })
    } else if (isContextReady(e)) {
      // The event doesn't name the preparing run; the card's preparation names its latest.
      const runId = e === lastReady ? (item.preparation?.runId ?? null) : null
      lines.push({ kind: 'prepared', at: e.at, run: look.run(runId) })
    } else if (e.payload.cleared === true) {
      // A new version cleared the answer, with Pilot's reply saying so.
      commit()
      lines.push({ kind: 'slot', at: e.at, run: null })
    }
  }
  commit()
  return withReplies(lines, item.replies)
}

// Each card's Message history from its events: the runs that asked and prepared it, every answer that went (one undone
// before it went is left out, one changed shows its last words), and the replies that came back.
export function cardHistories(
  store: PilotStore,
  items: readonly InboxItemRow[]
): Record<string, CardHistoryEntry[]> {
  const events = new Map<string, EventRow[]>()
  for (const e of store.events.forCards(
    items.map((i) => i.id),
    KINDS
  )) {
    const id = String(e.payload.id)
    events.set(id, [...(events.get(id) ?? []), e])
  }
  const look = lookups(store)
  return Object.fromEntries(items.map((i) => [i.id, historyOf(i, events.get(i.id) ?? [], look)]))
}
