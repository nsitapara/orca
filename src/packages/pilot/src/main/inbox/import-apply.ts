import type { InboxAnswer } from '../../shared/api-types'
import { SETTLE_MS } from '../answers/save'
import {
  reportOf,
  type ImportPlan,
  type ImportReport,
  type ImportRun,
  type PlannedItem
} from './import-vault'
import { addInboxItem, SAME_CARD_OPEN } from './inbox-add'
import { inboxEvent, syncRunWaiting, type InboxDeps } from './inbox-service'

function createRun(deps: InboxDeps, run: ImportRun): boolean {
  if (deps.store.runs.get(run.id)) {
    return false
  }
  const { runs } = deps.store
  runs.create({
    id: run.id,
    automationId: run.automationId,
    tickId: null,
    itemKey: run.itemKey,
    itemLabel: run.itemLabel,
    worktreePath: run.worktreePath,
    startedAt: run.startedAt,
    status: 'done',
    trigger: 'import',
    imported: true
  })
  runs.update(run.id, { finishedAt: run.startedAt })
  runs.createStep({
    runId: run.id,
    idx: 0,
    name: 'imported',
    agent: run.agent,
    skill: null,
    startedAt: run.startedAt,
    sessionId: run.sessionId,
    status: 'done'
  })
  runs.updateStep(run.id, 0, { finishedAt: run.startedAt })
  return true
}

export const SENT_BEFORE_PILOT =
  'Sent to the session before Pilot took over. Tick it (pilot inbox tick) once the session is done.'

class Skipped extends Error {}

// The saved answer, written onto the card the way saveAnswer does but with no caller kind: an imported
// approval therefore routes as a non-desktop answer (a re-ask), never a run. Called inside the card's
// transaction.
function writeAnswer(deps: InboxDeps, planned: PlannedItem, now: number): void {
  const answer = planned.answer
  const item = deps.store.inbox.get(planned.id)
  if (!answer || !item) {
    return
  }
  const stored: InboxAnswer = {
    option: answer.option,
    text: answer.text,
    digest: item.digest,
    via: answer.via
  }
  const replies = answer.sent ? [...item.replies, SENT_BEFORE_PILOT] : item.replies
  deps.store.inbox.update(
    item.id,
    { status: 'answered', answer: stored, answeredAt: now, answeredBy: item.person, replies },
    now
  )
  const row = deps.store.queue.enqueue(item.id, now + SETTLE_MS, now)
  if (answer.sent) {
    deps.store.queue.update(row, { state: 'dispatched', readyAt: now }, now)
  }
  inboxEvent(
    deps.store,
    item,
    'answer_saved',
    { text: answer.text, via: answer.via, option: answer.option, imported: true },
    now
  )
}

// The card (and its asking run, and its answer) in one transaction, so a crash or a refusal leaves
// nothing behind. Returns whether it created the run.
function addCard(
  deps: InboxDeps,
  plan: ImportPlan,
  planned: PlannedItem,
  now: number
): { reason: string | null; madeRun: boolean } {
  if (deps.store.inbox.get(planned.id)) {
    return { reason: 'already imported', madeRun: false }
  }
  const run = plan.runs.find((r) => r.id === planned.runId)
  let madeRun = false
  try {
    deps.store.transaction(() => {
      madeRun = run ? createRun(deps, run) : false
      const result = addInboxItem(
        { ...deps, now: () => now, newId: () => planned.id },
        planned.params,
        { source: 'import', vaultRef: planned.vaultRef, noMerge: true }
      )
      if (result.id !== planned.id) {
        throw new Skipped(result.refused ?? SAME_CARD_OPEN)
      }
      writeAnswer(deps, planned, now)
    })
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error), madeRun: false }
  }
  syncRunWaiting(deps.store, planned.runId, now)
  return { reason: null, madeRun }
}

// Every check addInboxItem makes, writing nothing.
function wouldAdd(deps: InboxDeps, planned: PlannedItem, now: number): string | null {
  if (deps.store.inbox.get(planned.id)) {
    return 'already imported'
  }
  try {
    const result = addInboxItem({ ...deps, now: () => now }, planned.plain, {
      source: 'import',
      noMerge: true,
      dryRun: true
    })
    return result.refused
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function applyVaultImport(
  deps: InboxDeps,
  plan: ImportPlan,
  now: number,
  opts: { dryRun?: boolean } = {}
): ImportReport {
  const skipped = [...plan.skipped]
  const done: PlannedItem[] = []
  let runs = 0
  const runsSeen = new Set<string>()
  for (const planned of plan.items) {
    const outcome = opts.dryRun
      ? { reason: wouldAdd(deps, planned, now), madeRun: false }
      : addCard(deps, plan, planned, now)
    if (outcome.reason) {
      const [note, key] = planned.vaultRef.split('#')
      skipped.push({ note, key, summary: planned.title, reason: outcome.reason })
      continue
    }
    done.push(planned)
    if (outcome.madeRun) {
      runs += 1
    }
    if (planned.runId && !runsSeen.has(planned.runId)) {
      runsSeen.add(planned.runId)
      runs += opts.dryRun && !deps.store.runs.get(planned.runId) ? 1 : 0
    }
  }
  return reportOf({ ...plan, items: done, skipped }, !opts.dryRun, runs)
}
