import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { DoneRun } from '../../shared/visibility-types'
import { saveAnswer } from '../answers/save'
import { toInboxSummary } from '../inbox/card'
import type { PilotContext } from '../pilot-services'
import { inboxDeps } from '../rpc/methods-inbox'
import { withDetail } from '../timeline/run-detail'
import type { RunEffectsReader } from './run-effects'

export const DONE_WINDOW_MS = 7 * 24 * 3600_000
export const DONE_LIMIT = 100

export type AcknowledgeResult = {
  acknowledged: string[]
  kept: string[]
  notKept: { id: string; error: string }[]
}

function openDefaults(ctx: PilotContext, runId: string) {
  return ctx.store.inbox.list({ runId, status: ['open'] }).filter((c) => c.type === 'default')
}

// The automations whose cards go to `person`; null (no person named) is every automation.
function automationsOf(ctx: PilotContext, person: string | null): string[] | null {
  if (person === null) {
    return null
  }
  return ctx
    .loaded()
    .definitions.filter((d) => d.inbox === person)
    .map((d) => d.id)
}

// pilot.runs.doneForYou: finished runs of the person's automations, not acknowledged, that changed something outside
// Pilot or took a default (spec §3), newest first.
export async function doneForYou(
  ctx: PilotContext,
  effects: RunEffectsReader,
  person: string | null,
  now: number
): Promise<DoneRun[]> {
  const runs = ctx.store.visibility.unacknowledged(
    automationsOf(ctx, person),
    now - DONE_WINDOW_MS,
    DONE_LIMIT
  )
  const shown = await Promise.all(
    withDetail(ctx.store, runs).map(async (run) => {
      const fields =
        run.tickId === null
          ? {}
          : (ctx.store.tickItems(run.tickId).find((i) => i.runId === run.id)?.fields ?? {})
      return {
        run: { ...run, fields },
        effects: await effects.forRun(run.id),
        defaults: openDefaults(ctx, run.id).map(toInboxSummary)
      }
    })
  )
  return shown.filter((d) => d.effects.length > 0 || d.defaults.length > 0)
}

// pilot.runs.acknowledge: Got it. Each run is acknowledged, and its open defaults get the Inbox's Keep answer. A card
// that can't take it (answered, closed or changed meanwhile) is reported, never fails the rest.
export function acknowledgeRuns(
  ctx: PilotContext,
  runIds: readonly string[],
  callerKind: RpcCallerIdentity['kind'],
  now: number
): AcknowledgeResult {
  const result: AcknowledgeResult = {
    acknowledged: ctx.store.visibility.acknowledge(runIds, now),
    kept: [],
    notKept: []
  }
  for (const card of runIds.flatMap((id) => openDefaults(ctx, id))) {
    try {
      saveAnswer(
        inboxDeps(ctx),
        { id: card.id, text: 'keep', digest: card.digest },
        { callerKind, catalog: ctx.actions }
      )
      result.kept.push(card.id)
    } catch (error) {
      result.notKept.push({
        id: card.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return result
}
