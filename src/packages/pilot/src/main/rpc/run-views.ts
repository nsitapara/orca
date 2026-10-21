import type { ActivityPayload, RunDetail, RunRow } from '../../shared/api-types'
import type { MergeBack } from '../../shared/api-types-runs'
import type { AutomationDefinition } from '../../shared/definition/types'
import { chainOf } from '../../shared/run-views/chain'
import { toInboxSummary } from '../inbox/card'
import type { PilotContext } from '../pilot-services'
import { listedRuns, tickItemOf } from '../timeline/run-detail'
import { activityTicks } from './activity-ticks'

export type ActivityListParams = {
  // Absent: every automation.
  automationIds?: string[]
  // Absent: no time bound, only `limit` ticks (an automation's or a job's tab, as before).
  since?: number
  limit: number
  skipQuiet: boolean
}

// Activity across automations (spec §3, §4): every live run, the ticks since `since` (or the newest `limit`), and the
// runs no tick started in the same span.
export function activityList(ctx: PilotContext, p: ActivityListParams): ActivityPayload {
  const ids = p.automationIds ?? null
  const ticks = ctx.store.activity.ticks(ids, p.since ?? 0, p.limit, p.skipQuiet)
  const oldest = ticks.at(-1)
  const cut = ticks.length === p.limit && oldest !== undefined
  const floor = Math.max(p.since ?? 0, cut ? oldest.startedAt : 0)
  return {
    live: listedRuns(ctx.store, ctx.store.activity.live(ids)),
    ticks: activityTicks(ctx, ticks, floor),
    loose: listedRuns(ctx.store, ctx.store.activity.unticked(ids, floor, p.limit)),
    // The page of ticks was full: the list was cut back to here.
    reach: cut ? floor : null
  }
}

// One run and everything its panel shows (spec §2 Run panel). A run whose automation is no longer loaded still opens: its
// chain is [] and the rail shows its stored steps.
export function runDetail(ctx: PilotContext, runId: string): RunDetail {
  const row = ctx.store.runs.get(runId)
  if (!row) {
    throw new Error(`No run "${runId}"`)
  }
  const definitions = ctx.loaded().definitions
  const def = definitions.find((d) => d.id === row.automationId) ?? null
  const tickItem = tickItemOf(ctx.store, row)
  const trigger =
    row.tickId === null
      ? null
      : (ctx.store.handovers.tickTriggers([row.tickId]).get(row.tickId) ?? null)
  return {
    run: {
      ...row,
      steps: ctx.store.runs.steps(row.id),
      inbox: ctx.store.inbox.list({ runId: row.id }).map(toInboxSummary),
      fields: tickItem?.fields ?? {}
    },
    automationName: def?.name ?? row.automationId,
    chain: def ? chainOf(def, definitions) : [],
    tickItem,
    trigger,
    handovers: ctx.store.handovers.sentBy(row.id),
    receivedFrom: ctx.store.handovers.startedBy(row.id),
    answerRuns: ctx.store.activity.children(row.id),
    mergeBack: mergeBackOf(ctx, row, definitions)
  }
}

function mergeBackOf(
  ctx: PilotContext,
  row: RunRow,
  definitions: readonly AutomationDefinition[]
): MergeBack | null {
  if (!row.env?.kept) {
    return null
  }
  const ids = definitions.filter((d) => d.items?.kind === 'kept_branch').map((d) => d.id)
  const key = `kept:${row.id}`
  const queued = ctx.store.capacity.queuedFor([key]).find((q) => ids.includes(q.automationId))
  return {
    runs: ctx.store.activity.forItem(ids, key),
    waiting: queued ? queued.holdDetail || 'Waiting for a slot' : null
  }
}
