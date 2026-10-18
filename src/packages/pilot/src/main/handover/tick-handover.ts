import type { HandoverRow, ItemDecision, TickHandover } from '../../shared/api-types'
import { activeFeed, readsFed } from '../../shared/definition/jobs'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { HandledState } from '../../shared/tick/decide'
import { handledStates } from '../scheduler/tick-decide'
import type { FedOutcome } from '../scheduler/tick-decide'
import type { PilotStore } from '../store/store'
import { HANDOVER_EXPIRY_MS, type HandoverResult } from '../store/store-handovers'

export { HANDOVER_EXPIRY_MS }
export const NOT_READ = 'Not read: its source returned no such item (closed, or not found)'

// The decision about a fed id's item: by key (<kind>:<id>) or label, whatever the case.
function decisionFor(decisions: readonly ItemDecision[], id: string): ItemDecision | undefined {
  const want = id.toLowerCase()
  return decisions.find(
    (d) => d.label.toLowerCase() === want || d.key.toLowerCase().endsWith(`:${want}`)
  )
}

// Whether a tick settles a fed id. Consumed: the tick started a run for the item (or holds one for an ask-first card),
// or the item definitely needs nothing: out of scope, already handled (its once_per key; a baseline counts), or gone
// from its source (closed, or not found). Anything that can change by the next tick keeps it pending: a check (skipped),
// quota, a busy worktree or a limit (held), a failed run's retry_after_failure wait, a scope that says not yet.
export function settles(
  decision: ItemDecision | undefined,
  handled: ReadonlyMap<string, HandledState>,
  retryAfterFailureMs: number | null
): boolean {
  if (decision === undefined) {
    return true
  }
  if (decision.verdict !== 'notdue') {
    return ['started', 'asked', 'out_of_scope', 'baselined'].includes(decision.verdict)
  }
  // decide.ts's handledGate: a handled key is due again only after a failed run's retry_after_failure.
  const state = handled.get(decision.onceKey)
  if (!state) {
    return false
  }
  return state.status !== 'failed' || retryAfterFailureMs === null || state.failedAt === null
}

export const NOT_FOUND = 'dropped: not found by its source'
const FAILED_RUN: ReadonlySet<string> = new Set(['failed', 'timed_out'])

// How a real tick settles the fed rows it saw. Consumed: the ones `settles` says, with the item's verdict and the run
// it started. Expired with why: ids the source can't read (dropped before the read) or found no item for. The rest
// stay pending for the next tick (triggered or scheduled).
// The run a settled id belongs to: the one this tick started or asked for, else the run holding its once_per key.
function runOf(
  d: ItemDecision | undefined,
  runIds: ReadonlyMap<string, string>,
  holders: ReadonlyMap<string, string | null>
): string | null {
  if (!d) {
    return null
  }
  if (d.verdict === 'started' || d.verdict === 'asked') {
    return runIds.get(d.key) ?? null
  }
  return holders.get(d.onceKey) ?? null
}

export function settleFed(
  store: PilotStore,
  def: AutomationDefinition,
  outcome: FedOutcome,
  decisions: readonly ItemDecision[],
  runIds: ReadonlyMap<string, string>,
  tickId: number,
  at: number
): void {
  if (outcome.fed.length === 0 && outcome.dropped.length === 0) {
    return
  }
  const rows = store.handledRows(def.id)
  const handled = handledStates(rows)
  // The run that holds each once_per key: an already-handled id is consumed with it, so that run failing re-pends it.
  const holders = new Map(rows.map((r) => [r.onceKey, r.runId]))
  const missing = new Set(outcome.missing.map((id) => id.toLowerCase()))
  const skipped = new Set(outcome.skipped.map((id) => id.toLowerCase()))
  const dropped: HandoverResult[] = outcome.dropped.map(({ row, reason }) => ({
    rowId: row.id,
    verdict: null,
    reason,
    runId: null,
    state: 'expired'
  }))
  const results = outcome.fed.flatMap((row): HandoverResult[] => {
    const d = decisionFor(decisions, row.itemId)
    if (!d && skipped.has(row.itemId.toLowerCase())) {
      return []
    }
    if (!d && missing.has(row.itemId.toLowerCase())) {
      return [{ rowId: row.id, verdict: null, reason: NOT_FOUND, runId: null, state: 'expired' }]
    }
    if (!settles(d, handled, def.retryAfterFailureMs)) {
      return []
    }
    const startedHere = d?.verdict === 'started' || d?.verdict === 'asked'
    const runId = runOf(d, runIds, holders)
    // Started (or asked) here, the id is consumed only with a run that exists and hasn't already failed: a card that
    // failed to record, a launch never made, or one that failed at once leaves it pending.
    if (
      startedHere &&
      (runId === null || FAILED_RUN.has(store.runs.get(runId)?.status ?? 'running'))
    ) {
      return []
    }
    return [{ rowId: row.id, verdict: d?.verdict ?? null, reason: d?.reason ?? NOT_READ, runId }]
  })
  store.handovers.consume(tickId, at, [...results, ...dropped])
}

// A real tick of a fed stage first expires its handovers pending longer than 7 days, so Activity shows them on it.
export function expireStale(
  store: PilotStore,
  def: AutomationDefinition,
  tickId: number,
  at: number
): void {
  if (readsFed(def)) {
    store.handovers.expire(def.id, at - HANDOVER_EXPIRY_MS, tickId, at)
  }
}

// What a stage's tick says about handovers: the ids it read, and what each passing or run: now feed hands on from
// the runs it started (would start, in a dry run). Undefined for an automation that neither feeds nor is fed.
export function handoverOf(
  def: AutomationDefinition,
  fed: readonly HandoverRow[],
  decisions: readonly ItemDecision[]
): TickHandover | undefined {
  const feeds = (def.job?.feeds ?? []).filter(activeFeed)
  if (feeds.length === 0 && !readsFed(def)) {
    return undefined
  }
  const starts = decisions.filter((d) => d.verdict === 'started').length
  return {
    read: fed.map((h) => h.itemId),
    feeds: feeds.map((f) => ({
      to: f.to,
      output: f.pass?.id ?? null,
      run: f.run,
      when: f.when,
      starts
    }))
  }
}
