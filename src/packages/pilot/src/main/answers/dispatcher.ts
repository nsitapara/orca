import type { InboxItemRow, QueueRoute, QueueRow, RunRow } from '../../shared/api-types'
import type { AttemptDeps } from '../actions/attempt'
import { oneLine } from '../inbox/card'
import {
  inboxEvent,
  reaskInboxItem,
  resolveInboxItem,
  syncRunWaiting,
  type InboxDeps
} from '../inbox/inbox-service'
import type { MrBlock } from '../inbox/mr-state'
import { retireTarget } from '../inbox/retire'
import type { PilotStore } from '../store/store'
import { dispatchToAgent, type AgentDispatchDeps } from './answer-run'
import { applyScript } from './apply-script'
import { hold, worktreeHold, type Hold, type HoldDeps } from './holds'
import type { AgentAnswer } from './prompt'
import { routeOf } from './queue-view'

export const MAX_ATTEMPTS = 3
// An approved action that isn't ready yet (act.py not_yet) is checked again this often, not every pass.
export const WAITS_RECHECK_MS = 5 * 60_000

export type DispatcherDeps = {
  inbox: InboxDeps
  attempt: AttemptDeps
  // Task 20b's InboxRetirer.
  retirer: { pass(): Promise<number>; blockFor(item: InboxItemRow): MrBlock | null }
  // Called once per pass, so a pass reads the terminals and agent states once (passActivity).
  holds(): HoldDeps
  agents: AgentDispatchDeps
  log(message: string): void
}
export type DispatchReport = {
  retired: number
  ticked: number
  actions: number
  agents: number
  held: number
  reasked: number
}
type Entry = { row: QueueRow; item: InboxItemRow }
type Group = { automationId: string; worktreePath: string | null; entries: Entry[] }

const PENDING: ReadonlySet<QueueRow['state']> = new Set(['not_ready', 'ready', 'held'])
const FINISHED_RUN: ReadonlySet<RunRow['status']> = new Set(['done', 'needs_you'])
const UNREAD_MR = "MR state unknown: it hasn't been read yet"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AnswerDispatcher {
  private current: Promise<DispatchReport> | null = null

  constructor(private readonly deps: DispatcherDeps) {}

  // One pass at a time: Apply now during a scheduled pass gets that pass (apply.py's note lock).
  pass(): Promise<DispatchReport> {
    if (!this.current) {
      this.current = this.run().finally(() => {
        this.current = null
      })
    }
    return this.current
  }

  // apply.py now: skip the settle of these answers (all, without ids), then run a pass. Only Pilot's
  // desktop app (`approver`, from the transport's caller) hurries an approval that runs an action past
  // the settle Nish has to change his mind; anyone else's call leaves those to their settle.
  applyNow(opts: { ids?: string[]; approver: boolean }): Promise<DispatchReport> {
    const { store, now } = this.deps.inbox
    const at = now()
    for (const row of store.queue.list(['not_ready', 'held'])) {
      if (row.readyAt <= at || (opts.ids && !opts.ids.includes(row.inboxItemId))) {
        continue
      }
      const item = store.inbox.get(row.inboxItemId)
      if (!item || (!opts.approver && routeOf(item, this.deps.attempt.catalog).kind === 'script')) {
        continue
      }
      store.queue.update(row.id, { readyAt: at }, at)
    }
    return this.pass()
  }

  private async run(): Promise<DispatchReport> {
    const report: DispatchReport = {
      retired: 0,
      ticked: 0,
      actions: 0,
      agents: 0,
      held: 0,
      reasked: 0
    }
    report.retired = await this.deps.retirer.pass()
    const holds = this.deps.holds()
    for (const group of this.groups()) {
      try {
        await this.dispatchGroup(group, holds, report)
      } catch (error) {
        const where = group.worktreePath ?? 'the repo'
        this.deps.log(
          `[pilot] answers for ${group.automationId} in ${where} failed: ${messageOf(error)}`
        )
      }
    }
    return report
  }

  // Answers past their settle (or a not-yet recheck), grouped like apply.py's notes: one automation,
  // one worktree.
  private groups(): Group[] {
    const { store, now } = this.deps.inbox
    const at = now()
    const groups = new Map<string, Group>()
    for (const row of store.queue.list(['not_ready', 'ready', 'held'])) {
      if (row.readyAt > at) {
        continue
      }
      const item = store.inbox.get(row.inboxItemId)
      if (!item || item.status !== 'answered') {
        store.queue.update(
          row.id,
          { state: 'failed', ...hold('retry', `the card is ${item?.status ?? 'gone'}`) },
          at
        )
        continue
      }
      if (row.state === 'not_ready') {
        store.queue.update(row.id, { state: 'ready' }, at)
      }
      const key = `${item.automationId}|${item.worktreePath ?? ''}`
      const group = groups.get(key) ?? {
        automationId: item.automationId,
        worktreePath: item.worktreePath,
        entries: []
      }
      group.entries.push({ row, item })
      groups.set(key, group)
    }
    return [...groups.values()]
  }

  // The pass awaits between reading an answer and acting on it: re-read both, so a card retired, ticked,
  // revised or answered again meanwhile is left alone (its new answer, if any, has its own queue row).
  private fresh(entry: Entry): Entry | null {
    const { store } = this.deps.inbox
    const row = store.queue.get(entry.row.id)
    const item = store.inbox.get(entry.item.id)
    if (!row || !PENDING.has(row.state) || !item || item.status !== 'answered') {
      return null
    }
    return { row, item }
  }

  private holdRows(entries: Entry[], held: Hold, report: DispatchReport): void {
    const { store, now } = this.deps.inbox
    const at = now()
    for (const entry of entries) {
      const current = this.fresh(entry)
      if (!current) {
        continue
      }
      const { row, item } = current
      const attempts = held.holdReason === 'retry' ? row.attempts + 1 : row.attempts
      const state = attempts >= MAX_ATTEMPTS ? 'failed' : 'held'
      const recheck = held.holdReason === 'waits' ? { readyAt: at + WAITS_RECHECK_MS } : {}
      store.queue.update(row.id, { state, ...held, attempts, ...recheck }, at)
      if (row.holdReason !== held.holdReason || row.holdDetail !== held.holdDetail) {
        inboxEvent(
          store,
          item,
          'answer_held',
          { reason: held.holdReason, detail: held.holdDetail },
          at
        )
      }
      report.held += 1
    }
  }

  private markSent(
    entries: Entry[],
    route: QueueRoute,
    runId: string,
    sessionId: string | null
  ): void {
    const { store, now } = this.deps.inbox
    const at = now()
    for (const entry of entries) {
      const current = this.fresh(entry)
      if (!current) {
        continue
      }
      const patch = {
        state: 'dispatched' as const,
        route,
        targetSessionId: sessionId,
        dispatchedRunId: runId
      }
      store.queue.update(current.row.id, patch, at)
      inboxEvent(store, current.item, 'answer_sent', { runId, route }, at)
    }
  }

  // A tick, a re-ask or an approved action happens here; an answer for an agent is returned, to go in
  // the group's one session.
  private async applyEntry(entry: Entry, report: DispatchReport): Promise<AgentAnswer | null> {
    const { item } = entry
    const route = routeOf(item, this.deps.attempt.catalog)
    if (route.kind === 'tick') {
      resolveInboxItem(this.deps.inbox, item.id, route.outcome)
      report.ticked += 1
      return null
    }
    if (route.kind === 'reask') {
      reaskInboxItem(this.deps.inbox, item.id, route.reason)
      report.reasked += 1
      return null
    }
    if (route.kind === 'agent') {
      return { item, revise: route.revise, needsAgent: null }
    }
    const step = await applyScript(
      { inbox: this.deps.inbox, attempt: this.deps.attempt },
      item,
      route.leaveOut
    )
    if (step.kind === 'agent') {
      return { item, revise: false, needsAgent: step.note }
    }
    if (step.kind === 'waits') {
      this.holdRows([entry], hold('waits', step.reason), report)
    } else if (step.kind === 'reasked') {
      report.reasked += 1
    } else {
      report.actions += 1
    }
    return null
  }

  // Why the group's MR stops it (GitLab couldn't say, or hasn't been asked yet), or null. A card whose MR
  // is finished was retired at the start of the pass; one the retirer couldn't close is left to it.
  private mrHold(entries: Entry[]): { hold: Hold | null; open: Entry[] } {
    const open: Entry[] = []
    for (const entry of entries) {
      const block = this.deps.retirer.blockFor(entry.item)
      if (block === null && retireTarget(this.deps.inbox.store, entry.item) !== null) {
        return { hold: hold('mr_unknown', UNREAD_MR), open: [] }
      }
      if (block && 'unknown' in block) {
        return { hold: hold('mr_unknown', block.unknown), open: [] }
      }
      if (!block?.finished) {
        open.push(entry)
      }
    }
    return { hold: null, open }
  }

  private async dispatchGroup(
    group: Group,
    holds: HoldDeps,
    report: DispatchReport
  ): Promise<void> {
    const def = this.deps.inbox.definitions().find((d) => d.id === group.automationId)
    if (!def) {
      this.holdRows(
        group.entries,
        hold('retry', `the automation "${group.automationId}" isn't loaded`),
        report
      )
      return
    }
    const mr = this.mrHold(group.entries)
    if (mr.hold) {
      this.holdRows(group.entries, mr.hold, report)
      return
    }
    const held = await worktreeHold(group.worktreePath, holds)
    if (held) {
      this.holdRows(mr.open, held, report)
      return
    }
    const forAgent: { entry: Entry; answer: AgentAnswer }[] = []
    for (const read of mr.open) {
      const entry = this.fresh(read)
      if (!entry) {
        continue
      }
      try {
        const answer = await this.applyEntry(entry, report)
        if (answer) {
          forAgent.push({ entry, answer })
        }
      } catch (error) {
        this.holdRows([entry], hold('retry', messageOf(error)), report)
      }
    }
    // Re-read once more: an action's run awaited, and its card or another may have moved on meanwhile.
    const still = forAgent.flatMap(({ entry, answer }) => {
      const now = this.fresh(entry)
      return now ? [{ entry: now, answer: { ...answer, item: now.item } }] : []
    })
    if (still.length === 0) {
      return
    }
    const entries = still.map((a) => a.entry)
    const sent = await dispatchToAgent(this.deps.agents, {
      def,
      worktreePath: group.worktreePath,
      rowId: entries[0].row.id,
      answers: still.map((a) => a.answer)
    })
    if (sent.kind === 'held') {
      this.holdRows(entries, sent.hold, report)
      return
    }
    this.markSent(entries, sent.route, sent.runId, sent.sessionId)
    report.agents += 1
  }
}

// G6/E-19: an answer run reports back with the outputs `outcome` (one line), `item_status` (done | stale |
// open) and an optional `reply`. When it ends, every card it was sent for that is still 'answered' gets that
// status: done (the default) closes it, stale marks it stale, open puts it back to its person with the
// reply under it. A card the agent already ticked (`pilot inbox tick`) is left alone. A run that didn't
// finish (failed, timed out, cancelled) queues its answers for another try (the dispatcher's usual three).
// Agent text is kept to one line, like every card field. Wired as RunEngineDeps.onRunEnd.
export function answerRunEnded(store: PilotStore, run: RunRow): void {
  if (run.trigger !== 'answer') {
    return
  }
  const at = run.finishedAt ?? Date.now()
  const outputs = store.runs
    .steps(run.id)
    .reduce<Record<string, unknown>>((all, s) => ({ ...all, ...s.outputs }), {})
  const text = (key: string): string =>
    typeof outputs[key] === 'string' ? oneLine(outputs[key]) : ''
  for (const row of store.queue.list(['dispatched']).filter((r) => r.dispatchedRunId === run.id)) {
    const item = store.inbox.get(row.inboxItemId)
    if (!item || item.status !== 'answered') {
      continue
    }
    if (!FINISHED_RUN.has(run.status)) {
      const attempts = row.attempts + 1
      const state = attempts >= MAX_ATTEMPTS ? 'failed' : 'held'
      store.queue.update(
        row.id,
        { state, ...hold('retry', `the answers session ended ${run.status}`), attempts },
        at
      )
      continue
    }
    const status = text('item_status')
    const outcome = text('outcome')
    const reply = text('reply')
    if (status === 'open') {
      store.inbox.update(
        item.id,
        { status: 'open', ...(reply ? { replies: [...item.replies, reply] } : {}) },
        at
      )
      inboxEvent(store, item, 'item_replied', { text: reply }, at)
    } else {
      const closed = status === 'stale' ? 'stale' : 'done'
      store.inbox.update(item.id, { status: closed, ...(outcome ? { outcome } : {}) }, at)
      inboxEvent(store, item, 'item_ticked', { status: closed, outcome }, at)
    }
    syncRunWaiting(store, item.runId, at)
  }
}
