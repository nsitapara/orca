import type { InboxItemRow, QueueRoute, QueueRow } from '../../shared/api-types'
import type { Route } from '../../shared/answers/route'
import type { DispatchReport } from '../../shared/inbox-types'
import type { AttemptDeps } from '../actions/attempt'
import {
  inboxEvent,
  reaskInboxItem,
  resolveInboxItem,
  type InboxDeps
} from '../inbox/inbox-service'
import type { MrBlock } from '../inbox/mr-state'
import { dispatchToAgent, type AgentDispatchDeps } from './answer-run'
import { applyScript } from './apply-script'
import { dueGroups, holdRows, lockEntries, mrHold, type Entry, type Group } from './dispatch-groups'
import { answersHold, hold, type Hold, type HoldDeps } from './holds'
import type { AgentAnswer } from './prompt'
import { routeOf } from './queue-view'

export type { DispatchReport }
export { answerRunEnded, ANSWER_RUN_STOPPED, MAX_ATTEMPTS } from './answer-run-end'
export { WAITS_RECHECK_MS } from './dispatch-groups'

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

const PENDING: ReadonlySet<QueueRow['state']> = new Set(['not_ready', 'ready', 'held'])
const CARD_ONLY: ReadonlySet<Route['kind']> = new Set(['tick', 'reask'])

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The answers went to an agent Pilot can't follow: they go back to their person, never sent again here.
export function answersUnfollowed(detail: string): string {
  return `Your answer went to an agent Pilot can't follow (${detail}); check it there before answering again.`
}

export class AnswerDispatcher {
  private current: Promise<DispatchReport> | null = null
  private followUp: Promise<DispatchReport> | null = null

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
    if (!this.current) {
      return this.pass()
    }
    // A pass already running has read its answers: one more pass after it takes the hurried ones. Calls
    // until that pass starts share it; one during it gets another.
    this.followUp ??= this.current
      .catch(() => undefined)
      .then(() => {
        this.followUp = null
        return this.pass()
      })
    return this.followUp
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
    for (const group of dueGroups(this.deps.inbox.store, this.deps.inbox.now())) {
      try {
        await this.dispatchGroup(group, holds, report)
      } catch (error) {
        const where = group.worktreePath ?? 'the repo'
        this.deps.log(
          `[pilot] answers for ${group.automationId} in ${where} failed: ${messageOf(error)}`
        )
        // A throw that repeats every pass counts as a try, so it ends failed (and unlocked) at the limit.
        this.holdRows(group.entries, hold('retry', messageOf(error)), report)
      }
    }
    return report
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
    const current = entries.flatMap((entry) => this.fresh(entry) ?? [])
    holdRows(store, current, held, now())
    report.held += current.length
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
    const mr = mrHold(this.deps.inbox.store, this.deps.retirer, group.entries)
    if (mr.hold) {
      this.holdRows(group.entries, mr.hold, report)
      return
    }
    // A tick or a re-ask changes only the card, so a busy or missing worktree never holds it.
    const touches = mr.open.filter(
      (e) => !CARD_ONLY.has(routeOf(e.item, this.deps.attempt.catalog).kind)
    )
    const held = touches.length ? await answersHold(def, group.worktreePath, holds) : null
    if (held) {
      this.holdRows(touches, held, report)
    }
    const go = held ? mr.open.filter((e) => !touches.includes(e)) : mr.open
    const forAgent: { entry: Entry; answer: AgentAnswer }[] = []
    const locked = lockEntries(this.deps.inbox.store, go, this.deps.inbox.now())
    for (const read of locked) {
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
    if (sent.kind === 'unfollowed') {
      this.handBack(entries, answersUnfollowed(sent.detail), report)
      return
    }
    if (sent.kind === 'dispatched') {
      this.markSent(entries, sent.route, sent.runId, sent.sessionId)
      report.agents += 1
      // An env answer run's env is begun only once its rows read sent, so its end always finds them (answer-env.ts).
      sent.afterSent?.()
    }
  }

  private handBack(entries: Entry[], why: string, report: DispatchReport): void {
    for (const entry of entries) {
      if (this.fresh(entry)) {
        reaskInboxItem(this.deps.inbox, entry.item.id, why)
        report.reasked += 1
      }
    }
  }
}
