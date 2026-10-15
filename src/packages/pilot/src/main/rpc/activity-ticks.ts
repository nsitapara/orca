import type { ActivityTick, EventRow, TickRow } from '../../shared/api-types'
import { HANDOVER_EXPIRED_EVENT } from '../handover/housekeep'
import type { PilotContext } from '../pilot-services'
import { withDetail } from '../timeline/run-detail'

export type Note = { at: number; text: string }

export function noteOf(e: EventRow): Note {
  return { at: e.at, text: typeof e.payload.text === 'string' ? e.payload.text : e.kind }
}

// Each expiry the scheduler pass recorded on a stage since `floor`, under that stage's newest tick that started before it
// (ticks newest first). Ticks of several automations each get their own stage's notes.
function notesByTick(
  ctx: PilotContext,
  ticks: readonly TickRow[],
  floor: number
): Map<number, Note[]> {
  const found = new Map<number, Note[]>()
  for (const id of new Set(ticks.map((t) => t.automationId))) {
    const own = ticks.filter((t) => t.automationId === id)
    const events = ctx.store.events.list({
      kinds: [HANDOVER_EXPIRED_EVENT],
      automationId: id,
      since: floor
    })
    for (const e of events) {
      const tick = own.find((t) => t.startedAt <= e.at)
      if (tick) {
        found.set(tick.id, [...(found.get(tick.id) ?? []), noteOf(e)])
      }
    }
  }
  return found
}

// Ticks (newest first) as Activity shows them: each with its items, its runs (with their steps and what they asked), what
// triggered it, the handed-over ids it read, and the notes under it. `floor`: the oldest moment notes are read from (0:
// all of them).
export function activityTicks(
  ctx: PilotContext,
  ticks: readonly TickRow[],
  floor: number
): ActivityTick[] {
  const runs = withDetail(
    ctx.store,
    ticks.flatMap((t) => ctx.store.runs.forTick(t.id))
  )
  const tickIds = ticks.map((t) => t.id)
  const triggers = ctx.store.handovers.tickTriggers(tickIds)
  const handedOver = ctx.store.handovers.consumedBy(tickIds)
  const definitions = ctx.loaded().definitions
  const stageOf = (id: string) => definitions.find((d) => d.id === id)?.job?.stage ?? null
  const notes = notesByTick(ctx, ticks, floor)
  return ticks.map((tick) => ({
    ...tick,
    trigger: triggers.get(tick.id) ?? null,
    handedOver: (handedOver.get(tick.id) ?? []).map((h) => ({
      ...h,
      senderStage: stageOf(h.senderId)
    })),
    notes: notes.get(tick.id) ?? [],
    items: ctx.store.tickItems(tick.id),
    runs: runs.filter((r) => r.tickId === tick.id)
  }))
}
