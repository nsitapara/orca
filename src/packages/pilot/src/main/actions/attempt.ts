import { homeOf } from '../../shared/api-types-env'
import type { AutomationDefinition } from '../../shared/definition/types'
import { EVIDENCE_ACTIONS } from '../../shared/evidence'
import type { InboxAddResult } from '../../shared/inbox-types'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'
import { resolveInboxPerson } from '../inbox/person'
import { fieldsForRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import { recordPilotAsk, refuseCall, refused, startRow, type Row } from './refuse'
import {
  argsDigest,
  cardToRun,
  definitionOf,
  hasPower,
  missingWhat,
  stableJson,
  unknownAction
} from './powers'
import {
  actionFailed,
  runSafely,
  type ActionCatalog,
  type ActionEntry,
  type ActionResult,
  type Refreshed
} from './types'

type AttemptBase = {
  action: string
  dryRun: boolean
  // The run that asked (resolved from the caller's step binding), or the run an approved card belongs to.
  runId: string | null
  // The step that asked; with the run and card it keys the attempt's pinned write id. Null outside a step.
  stepIdx?: number | null
}
// A run's own attempt, or an unbound dry run: the args it asks with; the run's powers apply.
export type RunAttempt = AttemptBase & {
  approved: false
  inboxItemId: null
  args: Record<string, unknown>
}
// A card's Approve, and nothing else: what runs is the card's own pinned args, re-read here, less the
// parts the person left out. Powers don't apply; the card's claim is re-checked (powers.ts cardToRun).
export type CardAttempt = AttemptBase & {
  approved: true
  inboxItemId: string
  // The digest the answer approved; a card that changed since is refused.
  digest: string
  leftOut?: string[]
}
export type AttemptRequest = RunAttempt | CardAttempt
export type AskedResult = { outcome: 'asked'; detail: string; inboxItemId: string | null }
export type AttemptResult = ActionResult | AskedResult
export type AttemptDeps = {
  store: PilotStore
  now(): number
  catalog: ActionCatalog
  definitions(): AutomationDefinition[]
  inbox: InboxDeps
}

// `pilot action run` exit codes: act.py's (act.py:34) plus 6 for "a person was asked first".
export const EXIT_CODES: Record<AttemptResult['outcome'], number> = {
  done: 0,
  failed: 1,
  stale: 3,
  needs_agent: 4,
  not_yet: 5,
  asked: 6
}

export const OUTSIDE_A_RUN =
  'Outside a Pilot run, approve actions in Pilot (Inbox), or run act.py directly.'
const NO_CARD = "An approval needs its card and the card's digest"

function rowOf(req: AttemptRequest): Row {
  const { action, dryRun, runId, inboxItemId, approved } = req
  return {
    action,
    dryRun,
    runId,
    inboxItemId,
    approved,
    ...(req.approved ? { digest: req.digest } : {})
  }
}

// A run attempt's own args; a card's come from the card. Anything malformed reads as none.
function argsOf(req: AttemptRequest): Record<string, unknown> {
  const given: unknown = req.approved ? null : req.args
  return given && typeof given === 'object' && !Array.isArray(given)
    ? (given as Record<string, unknown>)
    : {}
}

// What the entry's pin (a Linear write id) derives from: the run, step and card that asked, the action
// and its args. A retried attempt repeats all of them, so it pins the same id and Linear deduplicates it.
function pinned(
  entry: ActionEntry,
  req: AttemptRequest,
  args: Record<string, unknown>
): Record<string, unknown> {
  const key = stableJson([req.runId, req.stepIdx ?? null, req.inboxItemId, entry.name, args])
  return entry.pin ? entry.pin(args, key) : args
}

export { recordPilotAsk, refuseCall }

async function askFirst(
  deps: AttemptDeps,
  entry: ActionEntry,
  req: RunAttempt & { runId: string },
  def: AutomationDefinition,
  args: Record<string, unknown>
): Promise<AttemptResult> {
  const why = `"${def.name}" doesn't have ${missingWhat(entry)}`
  if (req.dryRun) {
    // A dry run changes nothing: no card that a person could approve into a real run.
    const fields = fieldsForRun(deps.store, req.runId)
    const person = resolveInboxPerson(def.inbox, fields, deps.inbox.people()).person
    const detail = `Would ask ${person ?? 'its person'} first: ${why}`
    return refused(deps, rowOf(req), args, { outcome: 'asked', detail, inboxItemId: null })
  }
  // R-P5: push and post_review are only ever offered prepared, never as a card Pilot asks about itself.
  if (EVIDENCE_ACTIONS.has(entry.name)) {
    const detail = `${entry.name} needs prepared evidence: ${why}, and it is only ever offered as a prepared card`
    return refused(deps, rowOf(req), args, actionFailed(detail))
  }
  const what = await entry.describe(args)
  let added: InboxAddResult
  try {
    added = addInboxItem(deps.inbox, {
      runId: req.runId,
      ...(req.stepIdx !== null && req.stepIdx !== undefined ? { stepIdx: req.stepIdx } : {}),
      type: 'action',
      title: `${what}?`,
      context: `Run ${req.runId} tried to ${what.charAt(0).toLowerCase()}${what.slice(1)}, but ${why}, so it waits for you.`,
      options: [`Approve — ${what.toLowerCase()} now`, 'Skip — leave it'],
      action: entry.name,
      actionArgs: args
    })
  } catch (error) {
    // attemptAction never throws: a card Pilot can't file is a recorded refusal, and nothing runs.
    return refused(deps, rowOf(req), args, actionFailed(`Couldn't ask first: ${String(error)}`))
  }
  const person = added.id ? (deps.store.inbox.get(added.id)?.person ?? 'its person') : null
  const detail = person
    ? `Asked ${person} first: ${why}`
    : `Not asked again: ${added.refused ?? 'refused'}`
  // Under the card, this row is how a later approval knows Pilot itself asked (powers.ts askedByPilot).
  const row = { ...rowOf(req), inboxItemId: added.id }
  return refused(deps, row, args, { outcome: 'asked', detail, inboxItemId: added.id })
}

function record(
  deps: AttemptDeps,
  row: Row,
  args: Record<string, unknown>,
  result: ActionResult,
  at: number
): void {
  const run = row.runId ? deps.store.runs.get(row.runId) : null
  deps.store.events.add({
    at,
    automationId: run?.automationId ?? null,
    runId: row.runId,
    worktreePath: run ? homeOf(run) : null,
    itemKey: run?.itemKey ?? null,
    kind: 'action_run',
    payload: {
      action: row.action,
      args,
      outcome: result.outcome,
      detail: result.detail,
      link: result.link,
      log: result.log,
      dryRun: row.dryRun,
      approved: row.approved,
      inboxItemId: row.inboxItemId
    }
  })
}

async function runEntry(
  deps: AttemptDeps,
  row: Row,
  entry: ActionEntry,
  args: Record<string, unknown>
): Promise<ActionResult> {
  const id = startRow(deps, row, args)
  const result = await runSafely(entry, args, {
    dryRun: row.dryRun,
    runId: row.runId,
    inboxItemId: row.inboxItemId
  })
  const at = deps.now()
  deps.store.actions.finish(id, result.outcome, JSON.stringify(result), at)
  if (result.outcome !== 'not_yet') {
    record(deps, row, args, result, at)
  }
  return result
}

async function attemptCard(
  deps: AttemptDeps,
  entry: ActionEntry,
  req: CardAttempt
): Promise<AttemptResult> {
  const row = rowOf(req)
  if (typeof req.inboxItemId !== 'string' || typeof req.digest !== 'string' || !req.digest) {
    return refused(deps, row, {}, actionFailed(NO_CARD))
  }
  const card = cardToRun(deps, entry, req, req.inboxItemId)
  if ('problem' in card) {
    const stored = deps.store.inbox.get(req.inboxItemId)?.actionArgs ?? {}
    return refused(deps, row, stored, actionFailed(card.problem))
  }
  // Already pinned with the card's key (powers.ts approvedArgs, which the card's Run line shows).
  return runEntry(deps, row, entry, card.args)
}

async function attemptForRun(
  deps: AttemptDeps,
  entry: ActionEntry,
  req: RunAttempt
): Promise<AttemptResult> {
  const row = rowOf(req)
  const given = argsOf(req)
  const bad = entry.checkArgs(given)
  if (bad) {
    return refused(deps, row, given, actionFailed(bad))
  }
  const args = pinned(entry, req, given)
  if (!req.runId) {
    // No run asked, and only a card's Approve is a person's approval: a dry run, which changes nothing.
    return req.dryRun
      ? runEntry(deps, row, entry, args)
      : refused(deps, row, args, actionFailed(OUTSIDE_A_RUN))
  }
  const run = deps.store.runs.get(req.runId)
  if (!run) {
    return refused(deps, row, args, actionFailed(`No run ${req.runId}`))
  }
  const def = definitionOf(deps, run.automationId)
  if (!def) {
    const detail = `Run ${run.id}'s automation "${run.automationId}" isn't loaded; nothing runs`
    return refused(deps, row, args, actionFailed(detail))
  }
  if (entry.power === null) {
    // Approval-only: only Pilot's own asks (ask_first's recordAsked) file these, never a run's attempt.
    const detail = `${entry.name} needs a person's approval; only Pilot asks for it`
    return refused(deps, row, args, actionFailed(detail))
  }
  if (!hasPower(entry, def)) {
    return askFirst(deps, entry, { ...req, runId: run.id }, def, args)
  }
  return runEntry(deps, row, entry, args)
}

// The one way anything in Pilot makes an outside effect, re-checked on every call, fail closed: the action
// is in the catalog and its args fit; a run's own attempt needs the run's automation to have the power
// (else its person is asked, and nothing runs); with no run, only a dry run goes ahead.
// A person's approval exists only through a card: Task 24c's Approve / Apply now calls this with
// { action: card.action, approved: true, inboxItemId: card.id, runId: card.runId, digest: <the digest the
// answer approved>, leftOut, dryRun: false }, and only for an answer saved from Pilot's desktop app (the
// approving caller must be `desktop`, never the CLI). The card is re-read and its own args run.
export async function attemptAction(
  deps: AttemptDeps,
  req: AttemptRequest
): Promise<AttemptResult> {
  const entry = deps.catalog.get(req.action)
  if (!entry) {
    return refused(deps, rowOf(req), argsOf(req), actionFailed(unknownAction(req.action)))
  }
  if (req.approved === true) {
    return attemptCard(deps, entry, req)
  }
  if (req.approved !== false || req.inboxItemId !== null) {
    // Not a shape the types allow: an approval must name its card, and a card is only run approved.
    return refused(deps, { ...rowOf(req), approved: false }, {}, actionFailed(NO_CARD))
  }
  return attemptForRun(deps, entry, req)
}

export async function refreshAction(
  deps: AttemptDeps,
  req: {
    action: string
    args: Record<string, unknown>
    runId: string | null
    inboxItemId: string | null
  }
): Promise<Refreshed | null> {
  const entry = deps.catalog.get(req.action)
  if (!entry?.refresh || entry.checkArgs(req.args)) {
    return null
  }
  const rowId = deps.store.actions.start({
    inboxItemId: req.inboxItemId,
    runId: req.runId,
    action: entry.name,
    args: req.args,
    digest: argsDigest(entry.name, req.args),
    phase: 'refresh',
    dryRun: false,
    startedAt: deps.now()
  })
  const got = await entry.refresh(req.args)
  // New args that don't fit the entry are no refresh: the card stays stale.
  const kept = got && entry.checkArgs(got.args) === null ? got : null
  // Nothing to re-pin is recorded as a failed refresh, with no output.
  deps.store.actions.finish(
    rowId,
    kept ? 'done' : 'failed',
    kept ? JSON.stringify(kept) : null,
    deps.now()
  )
  return kept
}
