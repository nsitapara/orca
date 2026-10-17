import type { CapacityPayload, CapacityRun, HeaviestJob } from '../../shared/api-types-capacity'
import { suggestRunLimit } from '../../shared/capacity/limit-suggestion'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { holdsSlot } from './run-capacity'
import type { RunMemorySnapshot } from './run-memory'
import type { SystemMemory } from './system-memory'

export type CapacityViewInput = {
  store: PilotStore
  definitions: readonly AutomationDefinition[]
  memory: RunMemorySnapshot | null
  system: SystemMemory
}

function heaviestJob(
  peaks: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, AutomationDefinition>
): HeaviestJob | null {
  let heaviest: HeaviestJob | null = null
  for (const [automationId, peakBytes] of peaks) {
    const def = byId.get(automationId)
    if (def && holdsSlot(def) && (heaviest === null || peakBytes > heaviest.peakBytes)) {
      heaviest = { automationId, automationName: def.name, peakBytes }
    }
  }
  return heaviest
}

// The Running page: the limit, every running run with its memory, the queue in line order, and a suggested limit.
export function capacityView(input: CapacityViewInput): CapacityPayload {
  const { store } = input
  const byId = new Map(input.definitions.map((d) => [d.id, d]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  const runs = store.capacity.running()
  const peaks = store.capacity.peaks(runs.map((r) => r.id))
  const running: CapacityRun[] = runs.map((run) => {
    const def = byId.get(run.automationId)
    return {
      id: run.id,
      automationId: run.automationId,
      automationName: nameOf(run.automationId),
      itemLabel: run.itemLabel,
      startedAt: run.startedAt,
      memoryBytes: input.memory?.runs.get(run.id) ?? null,
      peakBytes: peaks.get(run.id) ?? null,
      counted: def !== undefined && holdsSlot(def)
    }
  })
  const heaviest = heaviestJob(store.capacity.heaviestPeaks(), byId)
  const runningJobsBytes = running
    .filter((r) => r.counted)
    .reduce((sum, r) => sum + (r.memoryBytes ?? 0), 0)
  return {
    limit: store.capacity.runLimit(),
    running,
    queued: store.capacity
      .queued()
      .filter((q) => byId.has(q.automationId))
      .map((q) => ({ ...q, automationName: nameOf(q.automationId) })),
    memory: input.system,
    suggestion: suggestRunLimit({
      availableBytes: input.system.availableBytes,
      runningJobsBytes,
      worstJobBytes: heaviest?.peakBytes ?? null
    }),
    heaviest
  }
}
