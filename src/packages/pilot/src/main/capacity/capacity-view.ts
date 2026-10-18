import type { CapacityPayload, CapacityRun, HeaviestJob } from '../../shared/api-types-capacity'
import { suggestRunLimit, UNMEASURED_JOB_BYTES } from '../../shared/capacity/limit-suggestion'
import { QUOTA_CEILING } from '../../shared/quota-ceiling'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { listedRuns } from '../timeline/run-detail'
import { holdsSlot } from './run-capacity'
import type { RunMemorySnapshot } from './run-memory'
import type { SystemMemory } from './system-memory'

export type CapacityViewInput = {
  store: PilotStore
  definitions: readonly AutomationDefinition[]
  memory: RunMemorySnapshot | null
  system: SystemMemory
}

// The Running page's Finished list: the slot-holding jobs' newest ended runs.
export const MAX_FINISHED_RUNS = 10

// The heaviest of the jobs that hold a slot: a measured one at its peak, an enabled one never measured at the
// unmeasured budget, so a light job measured first can't talk the suggestion up before the heavy ones have run.
function heaviestJob(
  peaks: ReadonlyMap<string, number>,
  definitions: readonly AutomationDefinition[]
): HeaviestJob | null {
  let heaviest: HeaviestJob | null = null
  for (const def of definitions) {
    const peak = peaks.get(def.id)
    if (!holdsSlot(def) || (peak === undefined && !def.enabled)) {
      continue
    }
    const job = {
      automationId: def.id,
      automationName: def.name,
      peakBytes: peak ?? UNMEASURED_JOB_BYTES,
      measured: peak !== undefined
    }
    if (heaviest === null || job.peakBytes > heaviest.peakBytes) {
      heaviest = job
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
      idleMs: run.idleMs ?? 0,
      memoryBytes: input.memory?.runs.get(run.id) ?? null,
      peakBytes: peaks.get(run.id) ?? null,
      counted: def !== undefined && holdsSlot(def)
    }
  })
  const ended = store.capacity.finished(
    input.definitions.filter(holdsSlot).map((d) => d.id),
    MAX_FINISHED_RUNS
  )
  const endedPeaks = store.capacity.peaks(ended.map((r) => r.id))
  const heaviest = heaviestJob(store.capacity.heaviestPeaks(), input.definitions)
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
    finished: listedRuns(store, ended).map((run) => ({
      ...run,
      automationName: nameOf(run.automationId),
      peakBytes: endedPeaks.get(run.id) ?? null
    })),
    memory: input.system,
    suggestion: suggestRunLimit({
      availableBytes: input.system.availableBytes,
      runningJobsBytes,
      worstJobBytes: heaviest?.measured ? heaviest.peakBytes : null
    }),
    heaviest,
    quotaCeiling: { ...QUOTA_CEILING }
  }
}
