import type { HandoverRow, ItemDecision, TickHandover } from '../../shared/api-types'
import { activeFeed, readsFed } from '../../shared/definition/jobs'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { HandledState } from '../../shared/tick/decide'
import { handledStates } from '../scheduler/tick-decide'
import type { PilotStore } from '../store/store'
import { HANDOVER_EXPIRY_MS } from '../store/store-handovers'

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
// from its source (closed, or not found). Anything that can change by the next tick keeps it pending: a check, quota
// or busy worktree (skipped), the per-tick limit, a failed run's retry_after_failure wait, a scope that says not yet.
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

// Each fed row the tick settles is consumed with its item's verdict and the run it started; an id the source returned
// nothing for is consumed as not read. The rest stay pending for the next tick (triggered or scheduled).
export function consumeFed(
  store: PilotStore,
  def: AutomationDefinition,
  fed: readonly HandoverRow[],
  decisions: readonly ItemDecision[],
  runIds: ReadonlyMap<string, string>,
  tickId: number,
  at: number
): void {
  const handled = handledStates(store.handledRows(def.id))
  const results = fed.flatMap((row) => {
    const d = decisionFor(decisions, row.itemId)
    if (!settles(d, handled, def.retryAfterFailureMs)) {
      return []
    }
    return [
      {
        rowId: row.id,
        verdict: d?.verdict ?? null,
        reason: d?.reason ?? NOT_READ,
        runId: d ? (runIds.get(d.key) ?? null) : null
      }
    ]
  })
  store.handovers.consume(tickId, at, results)
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
