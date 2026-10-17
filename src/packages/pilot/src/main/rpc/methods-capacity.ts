import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { CapacityPayload } from '../../shared/api-types-capacity'
import { MAX_RUN_LIMIT } from '../../shared/capacity/limit-suggestion'
import { capacityView } from '../capacity/capacity-view'
import { readSystemMemory, type SystemMemory } from '../capacity/system-memory'
import type { PilotContext } from '../pilot-services'
import { CallerBinding, refuseAgentCaller } from './run-binding'

export const AGENT_SETS_LIMIT =
  "An agent in a Pilot run can't change how many runs go at once; Nish does that in Pilot"
// A sample older than this (the scheduler runs in another process, or stopped) gives way to a fresh reading.
const STALE_SAMPLE_MS = 60_000

// Null: no limit.
const SetLimit = z.object({
  limit: z.number().int().min(1).max(MAX_RUN_LIMIT).nullable(),
  ...CallerBinding
})

async function payload(
  c: PilotContext,
  readSystem: () => Promise<SystemMemory>,
  now: () => number
): Promise<CapacityPayload> {
  const memory = c.memory?.snapshot() ?? null
  const sampled = memory?.system ?? null
  const fresh =
    sampled !== null &&
    memory?.sampledAt !== null &&
    memory?.sampledAt !== undefined &&
    now() - memory.sampledAt < STALE_SAMPLE_MS
  return capacityView({
    store: c.store,
    definitions: c.loaded().definitions,
    memory,
    system: fresh ? sampled : await readSystem()
  })
}

// The Running page (main/capacity): what runs and waits, the run limit, and a suggested one.
export function buildCapacityMethods(
  ctx: () => PilotContext,
  readSystem: () => Promise<SystemMemory> = readSystemMemory,
  now: () => number = Date.now
) {
  return [
    defineMethod({
      name: 'pilot.capacity.get',
      permission: 'workspace',
      params: null,
      handler: () => payload(ctx(), readSystem, now)
    }),
    defineMethod({
      name: 'pilot.capacity.setLimit',
      permission: 'workspace',
      params: SetLimit,
      handler: (p, rpc) => {
        const c = ctx()
        refuseAgentCaller(c, rpc?.caller, p, AGENT_SETS_LIMIT)
        c.store.capacity.setRunLimit(p.limit, now())
        // A raised limit starts the queued items at once instead of at the next loop.
        if (c.schedulerOn) {
          void c.scheduler.tickAll()
        }
        return payload(c, readSystem, now)
      }
    })
  ]
}
