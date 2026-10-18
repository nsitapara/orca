import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'

// Only a job with an agent step holds a slot: a shell-only job (a git pull, a prune) never waits behind an agent.
export function holdsSlot(def: AutomationDefinition): boolean {
  return def.steps.some((step) => step.agent !== 'shell')
}

// queuedAt: when a started item joined the line; absent when it never waited.
export type Admission =
  | { start: true; byHand: boolean; queuedAt?: number }
  | { start: false; reason: string }

export type RunCapacity = {
  // Synchronous, so the check and the run it lets start can't interleave with another tick. A waiting item is
  // queued, keeping its place if it already had one; a started one leaves the queue.
  admit(def: AutomationDefinition, item: { key: string; label: string }, byHand: boolean): Admission
  // After a tick: its automation's queued items that this tick didn't leave waiting are no longer in line.
  settle(def: AutomationDefinition, decisions: readonly ItemDecision[]): void
  forget(automationId: string): void
  // An answer run goes ahead of the queue (Nish is waiting on it), so it needs only a free slot.
  hasFreeSlot(def: AutomationDefinition): boolean
  // The automations whose queued items can start now, oldest item first; rows of jobs that are gone, turned
  // off or ticked on another machine (ticksHere, runs_on) leave the line, unless Run now queued them.
  toTick(
    definitions: readonly AutomationDefinition[],
    ticksHere?: (def: AutomationDefinition) => boolean
  ): string[]
}

export type RunCapacityDeps = {
  store: PilotStore
  definitions(): readonly AutomationDefinition[]
  now(): number
}

function waitingReason(inUse: number, limit: number, ahead: number): string {
  const line = ahead === 0 ? '' : `, ${ahead} ahead`
  return `Waiting for a slot: ${inUse} of ${limit} running${line}`
}

export function runCapacity(deps: RunCapacityDeps): RunCapacity {
  const { capacity } = deps.store
  const holders = (also?: AutomationDefinition): Set<string> => {
    const ids = new Set(
      deps
        .definitions()
        .filter(holdsSlot)
        .map((d) => d.id)
    )
    if (also) {
      ids.add(also.id)
    }
    return ids
  }
  const inUse = (ids: Set<string>): number =>
    capacity.running().filter((run) => ids.has(run.automationId)).length
  const started = (def: AutomationDefinition, key: string, byHand: boolean): Admission => {
    const row = capacity.dequeue(def.id, key)
    const admission: Admission = { start: true, byHand: byHand || row?.byHand === true }
    return row ? { ...admission, queuedAt: row.queuedAt } : admission
  }

  return {
    admit(def, item, byHand) {
      const limit = capacity.runLimit()
      if (limit === null || !holdsSlot(def)) {
        return started(def, item.key, byHand)
      }
      const ids = holders(def)
      const used = inUse(ids)
      const line = capacity.queued().filter((q) => ids.has(q.automationId))
      const place = line.findIndex((q) => q.automationId === def.id && q.itemKey === item.key)
      const ahead = place === -1 ? line.length : place
      if (used + ahead < limit) {
        return started(def, item.key, byHand)
      }
      const now = deps.now()
      const reason = waitingReason(used, limit, ahead)
      capacity.enqueue({
        automationId: def.id,
        itemKey: item.key,
        itemLabel: item.label,
        queuedAt: now,
        byHand,
        dueAt: now,
        holdCode: 'capacity',
        holdDetail: reason,
        checkedAt: now
      })
      return { start: false, reason }
    },

    settle(def, decisions) {
      capacity.keepOnly(
        def.id,
        decisions.filter((d) => d.verdict === 'queued').map((d) => d.key)
      )
    },

    forget(automationId) {
      capacity.forget(automationId)
    },

    hasFreeSlot(def) {
      const limit = capacity.runLimit()
      return limit === null || !holdsSlot(def) || inUse(holders(def)) < limit
    },

    toTick(definitions, ticksHere = () => true) {
      const byId = new Map(definitions.map((d) => [d.id, d]))
      const limit = capacity.runLimit()
      let free = limit === null ? Number.POSITIVE_INFINITY : limit - inUse(holders())
      const ids: string[] = []
      for (const q of capacity.queued()) {
        const def = byId.get(q.automationId)
        if (!def || ((!def.enabled || !ticksHere(def)) && !q.byHand)) {
          capacity.dequeue(q.automationId, q.itemKey)
          continue
        }
        if (holdsSlot(def)) {
          if (free <= 0) {
            continue
          }
          free -= 1
        }
        if (!ids.includes(def.id)) {
          ids.push(def.id)
        }
      }
      return ids
    }
  }
}
