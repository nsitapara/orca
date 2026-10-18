import type { AutomationDefinition } from '../../shared/definition/types'
import { mapLimit } from '../map-limit'
import type { TickNowResult } from './scheduler'

export type QueuedTickDeps = {
  now(): number
  // Jobs whose waiting items can start now or are due a re-check, in line order (main/capacity/run-capacity.ts).
  queuedToTick?(definitions: readonly AutomationDefinition[], now: number): string[]
  log(message: string): void
}

// The scheduler's side: whether it is stopping, whether a job's tick runs now, a real tick, and how many run at once.
export type QueuedTickHost = {
  stopped(): boolean
  busy(id: string): boolean
  tick(id: string): Promise<TickNowResult>
  concurrency: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Waiting items go before the due ticks, their jobs started in line order, a few at once. admit counts the slot waiters
// due earlier, so a slot that frees goes to the item due longest, whatever its schedule or which tick ends first.
export async function tickQueued(
  deps: QueuedTickDeps,
  definitions: readonly AutomationDefinition[],
  host: QueuedTickHost
): Promise<void> {
  let ids: string[]
  try {
    ids = deps.queuedToTick?.(definitions, deps.now()) ?? []
  } catch (error) {
    deps.log(`[pilot] couldn't read the run queue: ${messageOf(error)}`)
    return
  }
  await mapLimit(ids, host.concurrency, async (id) => {
    if (host.stopped() || host.busy(id)) {
      return
    }
    try {
      const result = await host.tick(id)
      if (result.status === 'failed') {
        deps.log(`[pilot] ${id} queued tick failed: ${result.error}`)
      }
    } catch (error) {
      deps.log(`[pilot] ${id} queued tick failed: ${messageOf(error)}`)
    }
  })
}
