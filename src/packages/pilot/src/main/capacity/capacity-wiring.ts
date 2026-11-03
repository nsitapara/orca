import { listRegisteredPtys } from '../../../../../main/memory/pty-registry'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { readProcessTable } from './process-tree-memory'
import { runCapacity, type RunCapacity } from './run-capacity'
import { RunMemorySampler } from './run-memory'
import { readSystemMemory } from './system-memory'
import { terminalRootPid } from './terminal-root-pid'

// The run limit, memory reserves and their queue, read by every path that starts a run, and the sampler behind them
// and the Running page's memory figures, wired to Orca's runtime and its registry of local PTYs.
export function wireRunCapacity(deps: {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  definitions(): readonly AutomationDefinition[]
}): { capacity: RunCapacity; memory: RunMemorySampler } {
  const { runtime, store, now } = deps
  const memory = new RunMemorySampler({
    store,
    now,
    rootPid: terminalRootPid({
      ptyIdOf: async (handle) => (await runtime.showTerminal(handle)).ptyId,
      listPtys: listRegisteredPtys
    }),
    readProcesses: readProcessTable,
    readSystem: readSystemMemory
  })
  const memoryNow = () => {
    const last = memory.snapshot()
    return last.system ? { availableBytes: last.system.availableBytes, runs: last.runs } : null
  }
  return {
    capacity: runCapacity({ store, now, definitions: deps.definitions, memory: memoryNow }),
    memory
  }
}
