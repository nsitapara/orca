import type { HoldReason, ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import type { QueuedItem } from '../store/store-capacity'

// Only a job with an agent step holds a slot: a shell-only job (a git pull, a prune) never waits behind an agent.
export function holdsSlot(def: AutomationDefinition): boolean {
  return def.steps.some((step) => step.agent !== 'shell')
}

// queuedAt: when a started item joined the line; absent when it never waited.
export type Admission =
  | { start: true; byHand: boolean; queuedAt?: number }
  | { start: false; reason: string }

// dueAt: when the item became due, its place in the line (ms since epoch).
export type LineItem = { key: string; label: string; dueAt: number }

export type RunCapacity = {
  // Synchronous, so the check and the run it lets start can't interleave with another tick. A waiting item is
  // queued, keeping its place if it already had one; a started one leaves the queue.
  admit(def: AutomationDefinition, item: LineItem, byHand: boolean): Admission
  // An item a runner gate holds waits in line too, with or without a run limit, until a re-check starts it.
  hold(
    def: AutomationDefinition,
    item: LineItem,
    hold: { code: HoldReason; detail: string },
    byHand: boolean
  ): void
  // After a tick: its automation's waiting items that this tick didn't queue or hold are no longer in line.
  settle(def: AutomationDefinition, decisions: readonly ItemDecision[]): void
  forget(automationId: string): void
  // An answer run goes ahead of the queue (Nish is waiting on it), so it needs only a free slot.
  hasFreeSlot(def: AutomationDefinition): boolean
  // Jobs to tick now, in line order: slot-waiting items that fit the free slots, held items due a re-check. Rows of
  // jobs gone, turned off or ticked on another machine (ticksHere, runs_on) leave the line, unless Run now queued them.
  toTick(
    definitions: readonly AutomationDefinition[],
    ticksHere: (def: AutomationDefinition) => boolean,
    now: number
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

// Quota reads are cached for 5 minutes, and a time window needs no finer re-check than that.
export function recheckAfterMs(code: HoldReason): number {
  return code === 'quota' || code === 'window' ? 300_000 : 60_000
}

// Only slot-waiting rows due before the item are ahead of it: a held row never blocks a free slot. The line sorts by
// due time, then join time, then insertion, so a row the item doesn't have yet sorts after its ties.
function slotWaitersAhead(line: readonly QueuedItem[], self: number, itemDueAt: number): number {
  const own = self === -1 ? null : line[self]
  // The store keeps a row's earliest due time.
  const dueAt = own === null ? itemDueAt : Math.min(itemDueAt, own.dueAt)
  return line.filter((q, i) => {
    if (i === self || q.holdCode !== 'capacity') {
      return false
    }
    if (q.dueAt !== dueAt) {
      return q.dueAt < dueAt
    }
    if (own === null) {
      return true
    }
    return q.queuedAt === own.queuedAt ? i < self : q.queuedAt < own.queuedAt
  }).length
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
  // The store keeps the earliest due time and first join time of a row it already has.
  const wait = (
    def: AutomationDefinition,
    item: LineItem,
    hold: { code: HoldReason; detail: string },
    byHand: boolean
  ): void => {
    const now = deps.now()
    capacity.enqueue({
      automationId: def.id,
      itemKey: item.key,
      itemLabel: item.label,
      queuedAt: now,
      byHand,
      dueAt: item.dueAt,
      holdCode: hold.code,
      holdDetail: hold.detail,
      checkedAt: now
    })
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
      const self = line.findIndex((q) => q.automationId === def.id && q.itemKey === item.key)
      const ahead = slotWaitersAhead(line, self, item.dueAt)
      if (used + ahead < limit) {
        return started(def, item.key, byHand)
      }
      const reason = waitingReason(used, limit, ahead)
      wait(def, item, { code: 'capacity', detail: reason }, byHand)
      return { start: false, reason }
    },

    hold: wait,

    settle(def, decisions) {
      capacity.keepOnly(
        def.id,
        decisions.filter((d) => d.verdict === 'queued' || d.verdict === 'held').map((d) => d.key)
      )
    },

    forget(automationId) {
      capacity.forget(automationId)
    },

    hasFreeSlot(def) {
      const limit = capacity.runLimit()
      return limit === null || !holdsSlot(def) || inUse(holders(def)) < limit
    },

    toTick(definitions, ticksHere, now) {
      const byId = new Map(definitions.map((d) => [d.id, d]))
      const limit = capacity.runLimit()
      let free = limit === null ? Number.POSITIVE_INFINITY : limit - inUse(holders())
      const ids = new Set<string>()
      for (const q of capacity.queued()) {
        const def = byId.get(q.automationId)
        if (!def || ((!def.enabled || !ticksHere(def)) && !q.byHand)) {
          capacity.dequeue(q.automationId, q.itemKey)
          continue
        }
        if (q.holdCode !== 'capacity') {
          if (now - q.checkedAt >= recheckAfterMs(q.holdCode)) {
            ids.add(def.id)
          }
          continue
        }
        if (holdsSlot(def)) {
          if (free <= 0) {
            continue
          }
          free -= 1
        }
        ids.add(def.id)
      }
      return [...ids]
    }
  }
}
