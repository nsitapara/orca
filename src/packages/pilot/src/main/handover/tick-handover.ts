import type { HandoverRow, ItemDecision, TickHandover } from '../../shared/api-types'
import { activeFeed, readsFed } from '../../shared/definition/jobs'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'

export const NOT_READ = 'Not read: its source returned no such item (closed, or not found)'

// The decision about a fed id's item: by key (<kind>:<id>) or label, whatever the case.
function decisionFor(decisions: readonly ItemDecision[], id: string): ItemDecision | undefined {
  const want = id.toLowerCase()
  return decisions.find(
    (d) => d.label.toLowerCase() === want || d.key.toLowerCase().endsWith(`:${want}`)
  )
}

// Each fed row the tick read is consumed with its item's verdict, whatever it is, and the run it started; an id the
// source returned nothing for is consumed as not read. An item over the per-tick limit is left pending: the tick
// itself says it is the next tick's.
export function consumeFed(
  store: PilotStore,
  fed: readonly HandoverRow[],
  decisions: readonly ItemDecision[],
  runIds: ReadonlyMap<string, string>,
  tickId: number,
  at: number
): void {
  const results = fed.flatMap((row) => {
    const d = decisionFor(decisions, row.itemId)
    if (d?.verdict === 'over_limit') {
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
