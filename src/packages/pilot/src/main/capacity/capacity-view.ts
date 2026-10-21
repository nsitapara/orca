import type {
  CapacityPayload,
  CapacityRun,
  GaveUpKey,
  HeaviestJob,
  QuotaUse,
  RunStep
} from '../../shared/api-types-capacity'
import type { StepRow } from '../../shared/api-types'
import { suggestRunLimit, UNMEASURED_JOB_BYTES } from '../../shared/capacity/limit-suggestion'
import { QUOTA_CEILING } from '../../shared/quota-ceiling'
import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { runTabOf } from '../../shared/run-views/step-tab'
import { listedRuns } from '../timeline/run-detail'
import { holdsSlot } from './run-capacity'
import { runHome, runPlace } from './run-place'
import type { RunMemorySnapshot } from './run-memory'
import type { SystemMemory } from './system-memory'

export type CapacityViewInput = {
  store: PilotStore
  definitions: readonly AutomationDefinition[]
  memory: RunMemorySnapshot | null
  system: SystemMemory
  now: number
  // The runner's cached quota readings; absent where there are none, or they didn't answer in time.
  quotaUse?: Partial<Record<AgentKind, QuotaUse>>
}

// The Running page's Finished list: the slot-holding jobs' newest ended runs.
export const MAX_FINISHED_RUNS = 10
// Gave up lists the keys whose last failure is this recent.
export const GAVE_UP_WINDOW_MS = 7 * 24 * 60 * 60_000

// Keys of loaded jobs the runner retries; an ask-first job's never were retried, so never given up.
function gaveUpKeys(
  input: CapacityViewInput,
  byId: ReadonlyMap<string, AutomationDefinition>,
  limit: number
): GaveUpKey[] {
  return input.store.gaveUp(limit, input.now - GAVE_UP_WINDOW_MS).flatMap((row) => {
    const def = byId.get(row.automationId)
    if (!def || def.start === 'ask_first' || row.failedAt === null) {
      return []
    }
    return [
      {
        automationId: row.automationId,
        automationName: def.name,
        onceKey: row.onceKey,
        itemLabel: row.itemLabel,
        failures: row.failures,
        failedAt: row.failedAt,
        outcome: row.lastOutcome
      }
    ]
  })
}

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

// What a queued row's due time marks: its source's waitingSince, else the tick that first found it due.
function dueFromOf(def: AutomationDefinition | undefined): string {
  const items = def?.items
  if (!items) {
    return 'first due'
  }
  switch (items.kind) {
    case 'worktree':
      return items.where.commits ? 'oldest new commit' : 'first due'
    case 'linear_ticket':
      return 'ticket opened'
    case 'pipeline':
      return 'pipeline created'
    case 'inbox_preparation':
      return 'card posted'
    case 'kept_branch':
      return 'kept'
    case 'merge_request':
      return 'first due'
  }
}

// The step a run is starting or running, as its card names it.
function activeStepOf(steps: readonly StepRow[]): RunStep | undefined {
  const step = steps.find((s) => s.status === 'starting' || s.status === 'running')
  if (!step) {
    return undefined
  }
  return { name: step.name, kind: step.kind, skill: step.skill, mode: step.mode }
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
    const place = runPlace(run)
    const steps = store.runs.steps(run.id)
    const tab = runTabOf(steps, run.worktreePath)
    const step = activeStepOf(steps)
    return {
      id: run.id,
      automationId: run.automationId,
      automationName: nameOf(run.automationId),
      itemLabel: run.itemLabel,
      startedAt: run.startedAt,
      idleMs: run.idleMs ?? 0,
      memoryBytes: input.memory?.runs.get(run.id) ?? null,
      peakBytes: peaks.get(run.id) ?? null,
      counted: def !== undefined && holdsSlot(def),
      ...(place ? { place } : {}),
      ...(tab ? { tab } : {}),
      ...(run.trigger === 'answer' ? { fromAnswer: true as const } : {}),
      ...(step ? { step } : {})
    }
  })
  const ended = store.capacity.finished(
    input.definitions.filter(holdsSlot).map((d) => d.id),
    MAX_FINISHED_RUNS
  )
  const endedPeaks = store.capacity.peaks(ended.map((r) => r.id))
  const retryKeys = store.retryKeysOf(ended.map((r) => r.id))
  const retryLimit = store.capacity.retryLimit()
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
      .map((q) => ({
        ...q,
        automationName: nameOf(q.automationId),
        dueFrom: dueFromOf(byId.get(q.automationId))
      })),
    finished: listedRuns(store, ended).map((run) => {
      const onceKey = retryKeys.get(run.id)
      const place = runPlace(run)
      const home = runHome(run, byId.get(run.automationId))
      return {
        ...run,
        automationName: nameOf(run.automationId),
        peakBytes: endedPeaks.get(run.id) ?? null,
        ...(onceKey === undefined ? {} : { onceKey }),
        ...(place ? { place } : {}),
        ...(home ? { home } : {})
      }
    }),
    memory: input.system,
    suggestion: suggestRunLimit({
      availableBytes: input.system.availableBytes,
      runningJobsBytes,
      worstJobBytes: heaviest?.measured ? heaviest.peakBytes : null
    }),
    heaviest,
    quotaCeiling: { ...QUOTA_CEILING },
    ...(input.quotaUse ? { quotaUse: input.quotaUse } : {}),
    retryLimit,
    gaveUp: gaveUpKeys(input, byId, retryLimit)
  }
}
