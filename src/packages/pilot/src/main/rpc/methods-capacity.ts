import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { CapacityPayload } from '../../shared/api-types-capacity'
import { MAX_RUN_LIMIT } from '../../shared/capacity/limit-suggestion'
import { MAX_RETRY_LIMIT } from '../../shared/capacity/retry-limit'
import { capacityView } from '../capacity/capacity-view'
import { readSystemMemory, type SystemMemory } from '../capacity/system-memory'
import type { PilotContext } from '../pilot-services'
import { CallerBinding, refuseAgentCaller } from './run-binding'

export const AGENT_SETS_LIMIT =
  "An agent in a Pilot run can't change how many runs go at once; Nish does that in Pilot"
export const AGENT_SETS_RETRIES =
  "An agent in a Pilot run can't change how often a failed run is retried; Nish does that in Pilot"
// A sample older than this (the scheduler runs in another process, or stopped) gives way to a fresh reading.
const STALE_SAMPLE_MS = 60_000

// Null: no limit.
const SetLimit = z.object({
  limit: z.number().int().min(1).max(MAX_RUN_LIMIT).nullable(),
  ...CallerBinding
})
const SetRetryLimit = z.object({
  limit: z.number().int().min(0).max(MAX_RETRY_LIMIT),
  ...CallerBinding
})
const Retry = z.object({
  automationId: z.string().min(1),
  onceKey: z.string().min(1),
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
    system: fresh ? sampled : await readSystem(),
    now: now()
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
    }),
    defineMethod({
      name: 'pilot.capacity.setRetryLimit',
      permission: 'workspace',
      params: SetRetryLimit,
      handler: (p, rpc) => {
        const c = ctx()
        refuseAgentCaller(c, rpc?.caller, p, AGENT_SETS_RETRIES)
        c.store.capacity.setRetryLimit(p.limit, now())
        return payload(c, readSystem, now)
      }
    }),
    // A key the runner gave up on, or a failed run's: freed, then its job ticks with that key and its item by hand, so
    // the item goes through the job's checks and the runner's gates again; the job's other items wait for its next tick.
    defineMethod({
      name: 'pilot.capacity.retry',
      permission: 'workspace',
      params: Retry,
      handler: (p, rpc) => {
        const c = ctx()
        refuseAgentCaller(c, rpc?.caller, p)
        if (!c.loaded().definitions.some((d) => d.id === p.automationId)) {
          throw new Error(`No automation "${p.automationId}"`)
        }
        const itemKey = c.store.resetFailures(p.automationId, p.onceKey)
        if (c.schedulerOn) {
          const keys = itemKey === null ? [p.onceKey] : [p.onceKey, itemKey]
          const tick = { dryRun: false, byHandKeys: new Set(keys) }
          void c.scheduler.tickNow(p.automationId, tick).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[pilot] ${p.automationId}: Retry's tick failed: ${message}`)
          })
        }
        return payload(c, readSystem, now)
      }
    })
  ]
}
