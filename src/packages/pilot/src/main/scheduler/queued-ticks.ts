import type { AutomationDefinition } from '../../shared/definition/types'
import type { TickNowResult } from './scheduler'

export type QueuedTickDeps = {
  now(): number
  // Jobs whose waiting items can start now or are due a re-check, in line order (main/capacity/run-capacity.ts).
  queuedToTick?(definitions: readonly AutomationDefinition[], now: number): string[]
  log(message: string): void
}

// The scheduler's side: whether it is stopping, whether an automation's tick runs now, and a real tick.
export type QueuedTickHost = {
  stopped(): boolean
  busy(id: string): boolean
  tick(id: string): Promise<TickNowResult>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Waiting items go before the due ticks, one job at a time in line order: each tick admits its own items in order, so
// a slot that frees goes to the item due longest, whatever its schedule; a held item's job ticks at its re-check.
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
  for (const id of ids) {
    if (host.stopped()) {
      return
    }
    if (host.busy(id)) {
      continue
    }
    try {
      const result = await host.tick(id)
      if (result.status === 'failed') {
        deps.log(`[pilot] ${id} queued tick failed: ${result.error}`)
      }
    } catch (error) {
      deps.log(`[pilot] ${id} queued tick failed: ${messageOf(error)}`)
    }
  }
}
