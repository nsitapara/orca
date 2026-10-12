import { createHash } from 'node:crypto'
import type { AutomationDefinition } from '../../shared/definition/types'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'
import { resolveInboxPerson } from '../inbox/person'
import { fieldsForRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import { approvedCardProblem, definitionOf, hasPower, missingWhat, unknownAction } from './powers'
import {
  actionFailed,
  type ActionCatalog,
  type ActionEntry,
  type ActionResult,
  type Refreshed
} from './types'

export type AttemptRequest = {
  action: string
  args: Record<string, unknown>
  dryRun: boolean
  // The run that asked (resolved from the caller's step binding), or the run an approved card belongs to.
  runId: string | null
  // The step that asked; with the run and card it keys the attempt's pinned write id. Null outside a step.
  stepIdx?: number | null
  // Set for a card's Approve: the card is re-read and re-checked before anything runs.
  inboxItemId: string | null
  // A person approved it (a card's Approve, or a call from Pilot's desktop app or a paired device, as the
  // RPC transport proved it; never the CLI): powers don't apply.
  approved: boolean
  // The approved card's digest; absent, the args' own.
  digest?: string
}
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
  'Outside a Pilot run, approve actions in Pilot (Waiting on you), or run act.py directly.'

function argsDigest(action: string, args: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify([action, args]))
    .digest('hex')
}

// Key order never changes what an attempt is.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a < b ? -1 : 1
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// What the entry's pin (a Linear write id) derives from: the run, step and card that asked, the action
// and its args. A retried attempt repeats all of them, so it pins the same id and Linear deduplicates it.
function attemptKey(entry: ActionEntry, req: AttemptRequest): string {
  return stableJson([req.runId, req.stepIdx ?? null, req.inboxItemId, entry.name, req.args])
}

function startRow(
  deps: AttemptDeps,
  req: AttemptRequest,
  action: string,
  args: Record<string, unknown>,
  inboxItemId = req.inboxItemId
): number {
  return deps.store.actions.start({
    inboxItemId,
    runId: req.runId,
    action,
    args,
    digest: req.digest ?? argsDigest(action, args),
    phase: 'do',
    dryRun: req.dryRun,
    startedAt: deps.now()
  })
}

// An attempt turned away is still an action_runs row (contract §10), with why in its output.
function refused(
  deps: AttemptDeps,
  req: AttemptRequest,
  result: AttemptResult,
  args: Record<string, unknown> = req.args,
  inboxItemId = req.inboxItemId
): AttemptResult {
  const row = startRow(deps, req, req.action, args, inboxItemId)
  deps.store.actions.finish(row, 'refused', JSON.stringify(result), deps.now())
  return result
}

async function askFirst(
  deps: AttemptDeps,
  entry: ActionEntry,
  req: AttemptRequest & { runId: string },
  def: AutomationDefinition,
  args: Record<string, unknown>
): Promise<AttemptResult> {
  const why = `"${def.name}" doesn't have ${missingWhat(entry)}`
  if (req.dryRun) {
    // A dry run changes nothing: no card that a person could approve into a real run.
    const fields = fieldsForRun(deps.store, req.runId)
    const person = resolveInboxPerson(def.inbox, fields, deps.inbox.people()).person
    const detail = `Would ask ${person ?? 'its person'} first: ${why}`
    return refused(deps, req, { outcome: 'asked', detail, inboxItemId: null }, args, null)
  }
  const what = await entry.describe(args)
  const added = addInboxItem(deps.inbox, {
    runId: req.runId,
    ...(req.stepIdx !== null && req.stepIdx !== undefined ? { stepIdx: req.stepIdx } : {}),
    type: 'action',
    title: `${what}?`,
    context: `Run ${req.runId} tried to ${what.charAt(0).toLowerCase()}${what.slice(1)}, but ${why}, so it waits for you.`,
    options: [`Approve — ${what.toLowerCase()} now`, 'Skip — leave it'],
    action: entry.name,
    actionArgs: args
  })
  if (!added.id) {
    const result = {
      outcome: 'asked' as const,
      detail: `Not asked again: ${added.refused ?? 'refused'}`,
      inboxItemId: null
    }
    return refused(deps, req, result, args, null)
  }
  const person = deps.store.inbox.get(added.id)?.person ?? 'its person'
  const result = {
    outcome: 'asked' as const,
    detail: `Asked ${person} first: ${why}`,
    inboxItemId: added.id
  }
  return refused(deps, req, result, args, added.id)
}

function record(
  deps: AttemptDeps,
  req: AttemptRequest,
  entry: ActionEntry,
  args: Record<string, unknown>,
  result: ActionResult,
  at: number
): void {
  const run = req.runId ? deps.store.runs.get(req.runId) : null
  deps.store.events.add({
    at,
    automationId: run?.automationId ?? null,
    runId: req.runId,
    worktreePath: run?.worktreePath ?? null,
    itemKey: run?.itemKey ?? null,
    kind: 'action_run',
    payload: {
      action: entry.name,
      args,
      outcome: result.outcome,
      detail: result.detail,
      link: result.link,
      log: result.log,
      dryRun: req.dryRun,
      approved: req.approved,
      inboxItemId: req.inboxItemId
    }
  })
}

async function runEntry(
  deps: AttemptDeps,
  req: AttemptRequest,
  entry: ActionEntry,
  args: Record<string, unknown>
): Promise<ActionResult> {
  const row = startRow(deps, req, entry.name, args)
  const result = await entry.run(args, { dryRun: req.dryRun, runId: req.runId })
  const at = deps.now()
  deps.store.actions.finish(row, result.outcome, JSON.stringify(result), at)
  if (result.outcome !== 'not_yet') {
    record(deps, req, entry, args, result, at)
  }
  return result
}

// The one way anything in Pilot makes an outside effect. Every call re-checks, fail closed: the action
// is in the catalog and its args fit; a run's own attempt needs the run's automation to have the power
// (else its person is asked, and nothing runs); a card's approval re-reads the card and the powers
// (approvedCardProblem); only a person's own call (approved, no card: the transport proved Pilot's desktop
// app or a paired device) runs on their word, and an unapproved call with no run only dry-runs. Task 24c's
// Approve / Apply now calls this with { approved: true, inboxItemId: card.id, runId: card.runId,
// digest: card.digest }, so every approved card goes through those checks.
export async function attemptAction(
  deps: AttemptDeps,
  req: AttemptRequest
): Promise<AttemptResult> {
  const entry = deps.catalog.get(req.action)
  if (!entry) {
    return refused(deps, req, actionFailed(unknownAction(req.action)))
  }
  const bad = entry.checkArgs(req.args)
  if (bad) {
    return refused(deps, req, actionFailed(bad))
  }
  const args = entry.pin ? entry.pin(req.args, attemptKey(entry, req)) : req.args
  if (req.approved && req.inboxItemId !== null) {
    const problem = approvedCardProblem(deps, entry, req, req.inboxItemId)
    return problem
      ? refused(deps, req, actionFailed(problem), args)
      : runEntry(deps, req, entry, args)
  }
  if (req.approved) {
    return runEntry(deps, req, entry, args)
  }
  if (!req.runId) {
    // Nobody approved it and no run asked: only a dry run, which changes nothing, goes ahead.
    return req.dryRun
      ? runEntry(deps, req, entry, args)
      : refused(deps, req, actionFailed(OUTSIDE_A_RUN))
  }
  const run = deps.store.runs.get(req.runId)
  if (!run) {
    return refused(deps, req, actionFailed(`No run ${req.runId}`))
  }
  const def = definitionOf(deps, run.automationId)
  if (!def) {
    const detail = `Run ${run.id}'s automation "${run.automationId}" isn't loaded; nothing runs`
    return refused(deps, req, actionFailed(detail))
  }
  if (!hasPower(entry, def)) {
    return askFirst(deps, entry, { ...req, runId: run.id }, def, args)
  }
  return runEntry(deps, req, entry, args)
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
