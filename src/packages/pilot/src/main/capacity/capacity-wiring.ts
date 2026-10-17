import { listRegisteredPtys } from '../../../../../main/memory/pty-registry'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { readProcessTable } from './process-tree-memory'
import { runCapacity, type RunCapacity } from './run-capacity'
import { RunMemorySampler } from './run-memory'
import { readSystemMemory } from './system-memory'
import { terminalRootPid } from './terminal-root-pid'

// The run limit and its queue, read by every path that starts a run, and the sampler behind the Running page's
// memory figures, wired to Orca's runtime and its registry of local PTYs.
export function wireRunCapacity(deps: {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  definitions(): readonly AutomationDefinition[]
}): { capacity: RunCapacity; memory: RunMemorySampler } {
  const { runtime, store, now } = deps
  return {
    capacity: runCapacity({ store, now, definitions: deps.definitions }),
    memory: new RunMemorySampler({
      store,
      now,
      rootPid: terminalRootPid({
        ptyIdOf: async (handle) => (await runtime.showTerminal(handle)).ptyId,
        listPtys: listRegisteredPtys
      }),
      readProcesses: readProcessTable,
      readSystem: readSystemMemory
    })
  }
}
