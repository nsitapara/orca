import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { CapacityPayload, QuotaUse } from '../../shared/api-types-capacity'
import { MAX_RUN_LIMIT } from '../../shared/capacity/limit-suggestion'
import { MAX_RETRY_LIMIT } from '../../shared/capacity/retry-limit'
import type { AgentKind } from '../../shared/definition/types'
import { capacityView } from '../capacity/capacity-view'
import { readSystemMemory, type SystemMemory } from '../capacity/system-memory'
import { readQuotas, type QuotaReaders } from '../fields/quota'
import type { PilotContext } from '../pilot-services'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { CallerBinding, refuseAgentCaller, type CallBinding } from './run-binding'

export const AGENT_SETS_LIMIT =
  "An agent in a Pilot run can't change how many runs go at once; Nish does that in Pilot"
export const AGENT_SETS_RETRIES =
  "An agent in a Pilot run can't change how often a failed run is retried; Nish does that in Pilot"
// A sample older than this (the scheduler runs in another process, or stopped) gives way to a fresh reading.
const STALE_SAMPLE_MS = 60_000
// A stale cache refreshes in the background past this; the page shows the reading at its next poll.
export const QUOTA_WAIT_MS = 2_000

// The runner's cached readings, or none when a refresh doesn't answer within QUOTA_WAIT_MS.
export async function quotaUseWithin(
  readers: QuotaReaders | undefined,
  waitMs = QUOTA_WAIT_MS
): Promise<Partial<Record<AgentKind, QuotaUse>> | undefined> {
  if (!readers) {
    return undefined
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs)
  })
  return Promise.race([readQuotas(readers), late]).finally(() => clearTimeout(timer))
}

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
const GoNow = z.object({
  automationId: z.string().min(1),
  itemKey: z.string().min(1),
  ...CallerBinding
})

// Retry and Go now: a person's change to a job's item, then its tick by hand with those keys, after any running tick.
function changeThenTick(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  p: CallBinding & { automationId: string },
  what: string,
  change: () => readonly string[]
): void {
  refuseAgentCaller(c, caller, p)
  if (!c.loaded().definitions.some((d) => d.id === p.automationId)) {
    throw new Error(`No automation "${p.automationId}"`)
  }
  const keys = change()
  if (!c.schedulerOn) {
    return
  }
  void c.scheduler.tickByHand(p.automationId, keys).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[pilot] ${p.automationId}: ${what}'s tick failed: ${message}`)
  })
}

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
  const [system, quotaUse] = await Promise.all([
    fresh ? sampled : readSystem(),
    quotaUseWithin(c.quotas)
  ])
  return capacityView({
    store: c.store,
    definitions: c.loaded().definitions,
    memory,
    system,
    now: now(),
    ...(quotaUse ? { quotaUse } : {})
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
    // A key the runner gave up on, or a failed run's: freed, then its job ticks with that key and its item by hand.
    defineMethod({
      name: 'pilot.capacity.retry',
      permission: 'workspace',
      params: Retry,
      handler: (p, rpc) => {
        const c = ctx()
        changeThenTick(c, rpc?.caller, p, 'Retry', () => {
          const itemKey = c.store.resetFailures(p.automationId, p.onceKey)
          return itemKey === null ? [p.onceKey] : [p.onceKey, itemKey]
        })
        return payload(c, readSystem, now)
      }
    }),
    // An item waiting in line: marked, so the runner's waits pass it over once, then its job ticks with it by hand.
    defineMethod({
      name: 'pilot.capacity.goNow',
      permission: 'workspace',
      params: GoNow,
      handler: (p, rpc) => {
        const c = ctx()
        changeThenTick(c, rpc?.caller, p, 'Go now', () => {
          // Only where the scheduler runs does a tick read the mark at once; elsewhere it would sit unread.
          if (!c.schedulerOn) {
            throw new Error(SCHEDULER_OFF)
          }
          if (!c.store.capacity.markGoNow(p.automationId, p.itemKey)) {
            throw new Error(`"${p.itemKey}" isn't waiting in line for "${p.automationId}"`)
          }
          return [p.itemKey]
        })
        return payload(c, readSystem, now)
      }
    })
  ]
}
