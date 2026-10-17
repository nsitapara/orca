import type { AutomationDefinition } from '../../shared/definition/types'
import type { TickNowResult } from './scheduler'

export type QueuedTickDeps = {
  // The automations whose queued items can start now, oldest item first (main/capacity/run-capacity.ts).
  queuedToTick?(definitions: readonly AutomationDefinition[]): string[]
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

// Queued items go before the due ticks, one automation at a time and oldest item first: each tick admits its own
// items in line order, so a slot that frees goes to the item that waited longest, whatever its schedule.
export async function tickQueued(
  deps: QueuedTickDeps,
  definitions: readonly AutomationDefinition[],
  host: QueuedTickHost
): Promise<void> {
  let ids: string[]
  try {
    ids = deps.queuedToTick?.(definitions) ?? []
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
