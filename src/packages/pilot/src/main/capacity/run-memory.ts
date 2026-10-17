import type { StepRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import { treeRssBytes, type ProcessRow } from './process-tree-memory'
import type { SystemMemory } from './system-memory'

export type RunMemoryDeps = {
  store: PilotStore
  now(): number
  // The root process of an agent step's terminal on this machine; null for an SSH terminal or one that's gone.
  rootPid(step: StepRow): Promise<number | null>
  readProcesses(): Promise<ProcessRow[] | null>
  readSystem(): Promise<SystemMemory>
}

export type RunMemorySnapshot = {
  // Running runs measured in the last sample: the summed RSS of their agent terminals' process trees.
  runs: ReadonlyMap<string, number>
  system: SystemMemory | null
  sampledAt: number | null
}

// Sampled on the scheduler's poll. Shell steps aren't measured (their processes aren't tracked), nor are Docker
// containers, which live in Docker's VM; each run's highest sample is kept on its row as its peak.
export class RunMemorySampler {
  private last: RunMemorySnapshot = { runs: new Map(), system: null, sampledAt: null }

  constructor(private readonly deps: RunMemoryDeps) {}

  async sample(): Promise<void> {
    const agents = this.deps.store.runs.runningSteps().filter((step) => step.kind === 'agent')
    // With no agent running there is nothing to attribute, so the process table isn't read.
    const [system, table] = await Promise.all([
      this.deps.readSystem(),
      agents.length > 0 ? this.deps.readProcesses() : null
    ])
    const runs = new Map<string, number>()
    if (table) {
      const roots = new Map<string, number[]>()
      for (const step of agents) {
        const pid = await this.deps.rootPid(step)
        if (pid !== null) {
          roots.set(step.runId, [...(roots.get(step.runId) ?? []), pid])
        }
      }
      for (const [runId, pids] of roots) {
        const bytes = treeRssBytes(table, pids)
        if (bytes > 0) {
          runs.set(runId, bytes)
          this.deps.store.capacity.recordPeak(runId, bytes)
        }
      }
    }
    this.last = { runs, system, sampledAt: this.deps.now() }
  }

  snapshot(): RunMemorySnapshot {
    return this.last
  }
}
