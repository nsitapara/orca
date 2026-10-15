import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ItemFields, RunRow } from '../../shared/api-types'
import type { DoneRun } from '../../shared/visibility-types'
import { saveAnswer } from '../answers/save'
import { toInboxSummary } from '../inbox/card'
import { resolveInboxPerson } from '../inbox/person'
import type { PilotContext } from '../pilot-services'
import { inboxDeps } from '../rpc/methods-inbox'
import { withDetail } from '../timeline/run-detail'
import type { RunEffectsReader } from './run-effects'

export const DONE_WINDOW_MS = 7 * 24 * 3600_000
export const DONE_LIMIT = 100
export const DONE_SCAN_LIMIT = 1000
const PAGE = 100

export type AcknowledgeResult = {
  acknowledged: string[]
  kept: string[]
  notKept: { id: string; error: string }[]
}

function openDefaults(ctx: PilotContext, runId: string) {
  return ctx.store.inbox.list({ runId, status: ['open'] }).filter((c) => c.type === 'default')
}

// Whether a run's inbox goes to `person`: the one its template resolves to, or a group they are in.
function isFor(ctx: PilotContext, run: RunRow, fields: ItemFields, person: string): boolean {
  const { definitions, people } = ctx.loaded()
  const def = definitions.find((d) => d.id === run.automationId)
  if (!def) {
    return false
  }
  const { person: target } = resolveInboxPerson(def.inbox, fields, people)
  if (target === person) {
    return true
  }
  return people.groups.some((g) => g.id === target && g.members.includes(person))
}

function fieldsOf(ctx: PilotContext, run: RunRow): ItemFields {
  if (run.tickId === null) {
    return {}
  }
  return ctx.store.tickItems(run.tickId).find((i) => i.runId === run.id)?.fields ?? {}
}

// pilot.runs.doneForYou: finished runs of the person's automations, not acknowledged, that changed something outside
// Pilot or took a default (spec §3), newest first. Quiet runs are skipped, so it pages past them.
export async function doneForYou(
  ctx: PilotContext,
  effects: RunEffectsReader,
  person: string | null,
  now: number
): Promise<DoneRun[]> {
  const since = now - DONE_WINDOW_MS
  const shown: DoneRun[] = []
  for (let offset = 0; offset < DONE_SCAN_LIMIT && shown.length < DONE_LIMIT; offset += PAGE) {
    const page = ctx.store.visibility.unacknowledged(null, since, PAGE, offset)
    const mine = page.filter((r) => person === null || isFor(ctx, r, fieldsOf(ctx, r), person))
    const found = await Promise.all(
      withDetail(ctx.store, mine).map(async (run) => ({
        run: { ...run, fields: fieldsOf(ctx, run) },
        effects: await effects.forRun(run.id),
        defaults: openDefaults(ctx, run.id).map(toInboxSummary)
      }))
    )
    shown.push(...found.filter((d) => d.effects.length > 0 || d.defaults.length > 0))
    if (page.length < PAGE) {
      break
    }
  }
  return shown.slice(0, DONE_LIMIT)
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
    acknowledged: ctx.store.visibility.acknowledge([...new Set(runIds)], now),
    kept: [],
    notKept: []
  }
  for (const card of result.acknowledged.flatMap((id) => openDefaults(ctx, id))) {
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
