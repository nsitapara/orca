import type { InboxItemRow, ItemDecision, RunRow } from '../../shared/api-types'
import { startNotes, startsRun } from '../../shared/answers/route'
import type { AutomationDefinition } from '../../shared/definition/types'
import { renderTemplate } from '../../shared/template'
import { usesHandled } from '../../shared/tick/decide'
import { recordPilotAsk } from '../actions/refuse'
import { addInboxItem } from '../inbox/inbox-add'
import { resolveInboxItem, WAITING, type InboxDeps } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'
import type { RunEngineDeps } from './advance'

export type AskDeps = { store: PilotStore; now(): number; inbox: InboxDeps }

// The page's Approve and Skip buttons when the automation names no options (G4); Approve, or the first
// option, starts the run (catalog entry start_run).
export const ASK_OPTIONS = ['Approve — start it now', 'Skip — nothing starts']

export function askFirstCard(
  def: AutomationDefinition,
  decision: ItemDecision
): { title: string; context: string; options: string[] } {
  const card = def.askFirst ?? {
    title: `Start "${def.name}" for ${decision.label}?`,
    context: '',
    options: []
  }
  return {
    title: renderTemplate(card.title, decision.fields).text,
    context: renderTemplate(card.context, decision.fields).text,
    options: card.options.length > 0 ? card.options : ASK_OPTIONS
  }
}

function stringField(decision: ItemDecision, name: string): string | null {
  const value = decision.fields[name]
  return typeof value === 'string' && value !== '' ? value : null
}

// An item asked about again (a new head means a new once_per key): its older card no longer applies.
function supersede(
  deps: AskDeps,
  def: AutomationDefinition,
  decision: ItemDecision,
  runId: string
): void {
  const open = deps.store.inbox.list({
    automationId: def.id,
    itemKey: decision.key,
    status: WAITING
  })
  for (const item of open) {
    if (item.action === 'start_run' && item.actionArgs?.run_id !== runId) {
      resolveInboxItem(deps.inbox, item.id, `stale: asked again for ${decision.label}`, 'stale')
    }
  }
}

// The run row comes first (the card belongs to it), then the key is marked handled (G7). Only a card that
// could not be written releases the key again, so the next tick asks again; a person's Skip never does (R-1).
export function recordAsked(
  deps: AskDeps,
  def: AutomationDefinition,
  decision: ItemDecision,
  tickId: number,
  runId: string
): void {
  const at = deps.now()
  deps.store.runs.create({
    id: runId,
    automationId: def.id,
    tickId,
    itemKey: decision.key,
    itemLabel: decision.label,
    worktreePath: stringField(decision, 'worktree.path'),
    startedAt: at,
    status: 'asking',
    trigger: 'ask_first'
  })
  if (usesHandled(def)) {
    deps.store.markHandled(def.id, decision.onceKey, runId, at)
  }
  let askedCard: string | null = null
  try {
    supersede(deps, def, decision, runId)
    const card = askFirstCard(def, decision)
    const added = addInboxItem(deps.inbox, {
      runId,
      type: 'action',
      title: card.title,
      context: card.context,
      options: card.options,
      action: 'start_run',
      actionArgs: { run_id: runId }
    })
    if (!added.id) {
      throw new Error(added.refused ?? 'the card was refused')
    }
    // Pilot's own ask: the only reason an approval of this card may start the run (start_run has no power).
    askedCard = added.id
    recordPilotAsk(
      deps,
      { action: 'start_run', runId, inboxItemId: added.id },
      { run_id: runId },
      `Asked ${decision.label} first`
    )
  } catch (error) {
    if (askedCard) {
      // A card without Pilot's ask row could never be approved: close it before the run is cancelled.
      try {
        resolveInboxItem(deps.inbox, askedCard, 'stale: the ask could not be recorded', 'stale')
      } catch {}
    }
    if (usesHandled(def)) {
      deps.store.unmarkHandledForRun(def.id, runId)
    }
    deps.store.runs.update(runId, {
      status: 'cancelled',
      outcome: `Couldn't ask: ${error instanceof Error ? error.message : String(error)}`,
      finishedAt: at
    })
    throw error
  }
}

// Called by the tick runner on a real tick (never a dry run) for every `asked` decision. An item whose
// card can't be written is logged and left for the next tick; it gets no run id.
export function askDecisions(
  deps: AskDeps,
  def: AutomationDefinition,
  decisions: ItemDecision[],
  runIds: Map<string, string>,
  ctx: { tickId: number; runIdFor(n: number): string }
): void {
  let n = 0
  for (const decision of decisions) {
    if (decision.verdict !== 'asked') {
      continue
    }
    n += 1
    const runId = ctx.runIdFor(n)
    try {
      recordAsked(deps, def, decision, ctx.tickId, runId)
      runIds.set(decision.key, runId)
    } catch (error) {
      console.error(
        `pilot: couldn't ask about ${decision.label}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

// The inbox's onResolved hook: an ask-first card that closed without starting its run cancels the run.
export function cancelUnstartedRun(store: PilotStore, item: InboxItemRow, at: number): void {
  if (item.action !== 'start_run') {
    return
  }
  const runId = item.actionArgs?.run_id
  if (typeof runId !== 'string') {
    return
  }
  // Only the run's own card cancels it: a card an agent filed naming another run is not that run's.
  if (item.runId !== runId) {
    console.error(
      `pilot: card ${item.id} names run ${runId} but belongs to ${item.runId ?? 'none'}`
    )
    return
  }
  const run = store.runs.get(runId)
  if (run?.status === 'asking') {
    store.runs.update(run.id, {
      status: 'cancelled',
      outcome: `Not started: ${item.outcome ?? item.status}`,
      finishedAt: at
    })
  }
}

// {run.answer} (G7, R-2), wired as RunEngineDeps.runAnswer: the free text of the answer that started a run.
// An answer run: its answers, one per line (the `answer_run` event Task 24b records). An ask_first run: the
// notes after "approve:" on its start_run card, '' for a plain Approve. Any other run: null.
export function runAnswerOf(store: PilotStore, run: RunRow): string | null {
  if (run.trigger === 'answer') {
    const event = store.events.list({ runId: run.id, kinds: ['answer_run'], limit: 1 })[0]
    return typeof event?.payload?.answer === 'string' ? event.payload.answer : ''
  }
  if (run.trigger === 'ask_first') {
    const card = store.inbox.list({ runId: run.id }).find((i) => i.action === 'start_run')
    return startNotes(card?.answer?.text ?? '')
  }
  return null
}

// {run.choice}, wired as RunEngineDeps.runChoice: the label of the option that started an ask-first run. Words
// ("approve", Approve with notes… on a single-start card) start the first option. '' for any other run.
export function runChoiceOf(store: PilotStore, run: RunRow): string {
  if (run.trigger !== 'ask_first') {
    return ''
  }
  const card = store.inbox.list({ runId: run.id }).find((i) => i.action === 'start_run')
  const labels = card?.options.map((o) => o.label) ?? []
  const picked = card?.answer?.option
  if (typeof picked === 'number' && startsRun(picked, labels)) {
    return labels[picked]
  }
  return labels[0] ?? ''
}

// The run engine's {run.answer} and {run.choice} sources, read from the store.
export function runAnswerSources(
  store: PilotStore
): Pick<RunEngineDeps, 'runAnswer' | 'runChoice'> {
  return {
    runAnswer: (run) => runAnswerOf(store, run),
    runChoice: (run) => runChoiceOf(store, run)
  }
}
