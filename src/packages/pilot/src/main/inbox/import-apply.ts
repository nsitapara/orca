import type { InboxAnswer } from '../../shared/api-types'
import { SETTLE_MS } from '../answers/save'
import {
  reportOf,
  type ImportPlan,
  type ImportReport,
  type ImportRun,
  type PlannedItem
} from './import-vault'
import { addInboxItem } from './inbox-add'
import type { InboxDeps } from './inbox-service'

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

// The saved answer, written onto the card the way saveAnswer does but with no caller kind: an imported
// approval therefore routes as a non-desktop answer (a re-ask), never a run.
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
  deps.store.transaction(() => {
    deps.store.inbox.update(
      item.id,
      { status: 'answered', answer: stored, answeredAt: now, answeredBy: item.person },
      now
    )
    const row = deps.store.queue.enqueue(item.id, now + SETTLE_MS, now)
    if (answer.sent) {
      deps.store.queue.update(row, { state: 'dispatched', readyAt: now }, now)
    }
  })
}

export function applyVaultImport(deps: InboxDeps, plan: ImportPlan, now: number): ImportReport {
  const skipped = [...plan.skipped]
  let runs = 0
  for (const run of plan.runs) {
    runs += createRun(deps, run) ? 1 : 0
  }
  const done: PlannedItem[] = []
  for (const planned of plan.items) {
    const reason = addCard(deps, planned, now)
    if (reason) {
      skipped.push({
        note: planned.vaultRef.split('#')[0],
        key: planned.vaultRef.split('#')[1],
        summary: planned.title,
        reason
      })
      continue
    }
    writeAnswer(deps, planned, now)
    done.push(planned)
  }
  return reportOf({ ...plan, items: done, skipped }, true, runs)
}

// null when the card was added; else why it wasn't (the engine's own refusal, or a same card already open).
function addCard(deps: InboxDeps, planned: PlannedItem, now: number): string | null {
  if (deps.store.inbox.get(planned.id)) {
    return 'already imported'
  }
  try {
    const result = addInboxItem(
      { ...deps, now: () => now, newId: () => planned.id },
      planned.params,
      { source: 'import', vaultRef: planned.vaultRef }
    )
    if (result.refused) {
      return result.refused
    }
    return result.id === planned.id ? null : `the same card is already open (${result.id})`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
