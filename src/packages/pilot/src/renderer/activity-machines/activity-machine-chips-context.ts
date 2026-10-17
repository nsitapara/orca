import { createContext } from 'react'
import type { ExecutionHostId } from '../../../../../shared/execution-host'

/** An Activity list's one machine-span decision: a label per raw host id while its rows span machines. */
export type ActivityMachineChips = {
  labels: ReadonlyMap<string, string>
  defaultHostId: ExecutionHostId
}

// Null while the rows sit on one machine, or before Pilot attaches: no row shows a chip.
export const ActivityMachineChipsContext = createContext<ActivityMachineChips | null>(null)
