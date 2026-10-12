import type { InboxAnswer } from '../../shared/api-types'
import type { InboxAddParams } from '../../shared/inbox-types'
import { SENT_BEFORE_PILOT } from '../../shared/pilot-replies'
import { SETTLE_MS } from '../answers/save'
import {
  reportOf,
  type ImportPlan,
  type ImportReport,
  type ImportRun,
  type PlannedItem
} from './import-vault'
import { DetailsRefused } from './details-bundle'
import { backfillDetails } from './import-backfill'
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

export { SENT_BEFORE_PILOT }

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
  const sent = { text: SENT_BEFORE_PILOT, by: 'pilot' as const }
  const replies = answer.sent ? [...item.replies, sent] : item.replies
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

const UNKNOWN_WORKTREE = /is not a worktree of/

// A sessionless branch card names a worktree the automation may not have shown yet: it is then filed
// job-wide, without it, rather than lost.
function withoutWorktree(params: InboxAddParams): InboxAddParams {
  const { worktreePath: _dropped, ...rest } = params
  return rest
}

function isUnknownWorktree(error: unknown, params: InboxAddParams): boolean {
  return (
    Boolean(params.worktreePath) && error instanceof Error && UNKNOWN_WORKTREE.test(error.message)
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Tries the params, then (a branch card naming a worktree the automation hasn't shown) without the worktree.
function orWithoutWorktree<T>(params: InboxAddParams, add: (p: InboxAddParams) => T): T {
  try {
    return add(params)
  } catch (error) {
    if (!isUnknownWorktree(error, params)) {
      throw error
    }
    return add(withoutWorktree(params))
  }
}

// A refused bundle never loses the card (ruling 8): it is offered without it, with a line naming the bundle
// and why Pilot doesn't show it. `refused` is that reason, null when the bundle (if any) was taken.
function orWithoutBundle<T>(
  params: InboxAddParams,
  add: (p: InboxAddParams) => T
): { value: T; refused: string | null } {
  try {
    return { value: add(params), refused: null }
  } catch (error) {
    if (!(error instanceof DetailsRefused)) {
      throw error
    }
    const { detailsBundlePath, ...rest } = params
    const detailsMd = `Details bundle: ${detailsBundlePath} (not shown in Pilot: ${error.reason})`
    return { value: add({ ...rest, detailsMd }), refused: error.reason }
  }
}

type Outcome = { reason: string | null; madeRun: boolean; refused: string | null }

// The card (and its asking run, and its answer) in one transaction, so a crash or a refusal leaves
// nothing behind. Says whether it created the run, and why its bundle was refused, if it was.
function addCard(deps: InboxDeps, plan: ImportPlan, planned: PlannedItem, now: number): Outcome {
  if (deps.store.inbox.get(planned.id)) {
    return { reason: 'already imported', madeRun: false, refused: null }
  }
  const run = plan.runs.find((r) => r.id === planned.runId)
  let madeRun = false
  const attempt = (params: InboxAddParams) =>
    deps.store.transaction(() => {
      madeRun = run ? createRun(deps, run) : false
      const result = addInboxItem({ ...deps, now: () => now, newId: () => planned.id }, params, {
        source: 'import',
        vaultRef: planned.vaultRef,
        noMerge: true
      })
      if (result.id !== planned.id) {
        throw new Skipped(result.refused ?? SAME_CARD_OPEN)
      }
      writeAnswer(deps, planned, now)
    })
  let refused: string | null
  try {
    refused = orWithoutBundle(planned.params, (p) => orWithoutWorktree(p, attempt)).refused
  } catch (error) {
    return { reason: messageOf(error), madeRun: false, refused: null }
  }
  syncRunWaiting(deps.store, planned.runId, now)
  return { reason: null, madeRun, refused }
}

// Every check addInboxItem makes, the bundle's included, writing nothing.
function wouldAdd(deps: InboxDeps, planned: PlannedItem, now: number): Outcome {
  if (deps.store.inbox.get(planned.id)) {
    return { reason: 'already imported', madeRun: false, refused: null }
  }
  const check = (params: InboxAddParams) =>
    addInboxItem({ ...deps, now: () => now }, params, {
      source: 'import',
      noMerge: true,
      dryRun: true
    }).refused
  try {
    const { value, refused } = orWithoutBundle(planned.plain, (p) => orWithoutWorktree(p, check))
    return { reason: value, madeRun: false, refused }
  } catch (error) {
    return { reason: messageOf(error), madeRun: false, refused: null }
  }
}

export function applyVaultImport(
  deps: InboxDeps,
  plan: ImportPlan,
  now: number,
  opts: { dryRun?: boolean } = {}
): ImportReport {
  const skipped = [...plan.skipped]
  const notes = [...plan.notes]
  const done: PlannedItem[] = []
  let runs = 0
  let bundled = 0
  const runsSeen = new Set<string>()
  for (const planned of plan.items) {
    const outcome = opts.dryRun ? wouldAdd(deps, planned, now) : addCard(deps, plan, planned, now)
    if (outcome.reason) {
      const [note, key] = planned.vaultRef.split('#')
      skipped.push({ note, key, summary: planned.title, reason: outcome.reason })
      continue
    }
    done.push(planned)
    if (outcome.refused) {
      notes.push({ id: planned.id, note: `Details not attached: ${outcome.refused}` })
    } else if (planned.params.detailsBundlePath) {
      bundled += 1
    }
    if (outcome.madeRun) {
      runs += 1
    }
    if (planned.runId && !runsSeen.has(planned.runId)) {
      runsSeen.add(planned.runId)
      runs += opts.dryRun && !deps.store.runs.get(planned.runId) ? 1 : 0
    }
  }
  const filled = backfillDetails(deps, plan.backfill, opts)
  return reportOf(
    { ...plan, items: done, skipped: [...skipped, ...filled.skipped], notes },
    !opts.dryRun,
    runs,
    { backfilled: filled.backfilled, details: bundled + filled.backfilled }
  )
}
