import type { RunEndHandover } from '../run/run-close'
import { runEndHandover, type HandOverDeps } from './hand-over'
import { handoverHousekeeper } from './housekeep'

// What a Pilot process wires: closeRun's handover, written with each run's end (deps.trigger is set once the scheduler
// exists), and the scheduler pass's housekeeping of the handovers, at most once an hour.
export type HandoverService = {
  deps: HandOverDeps
  runEnd: RunEndHandover
  housekeep(): void
}

export function handoverService(deps: HandOverDeps): HandoverService {
  const stageOf = (id: string) => deps.definitionFor(id)?.job?.stage ?? null
  const keeper = handoverHousekeeper(deps.store, deps.now, deps.log, stageOf)
  return {
    deps,
    runEnd: runEndHandover(deps),
    housekeep: () => {
      keeper.passIfDue()
    }
  }
}
