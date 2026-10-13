import type { RunRow } from '../../shared/api-types'
import type { RunEnd } from '../../shared/run/step-plan'
import { handOverRunEnd, type HandOverDeps } from './hand-over'
import { handoverHousekeeper } from './housekeep'

// What a Pilot process wires: each run's end hands over to the next stage (deps.trigger is set once the scheduler
// exists), and the scheduler pass housekeeps the handovers at most once an hour.
export type HandoverService = {
  deps: HandOverDeps
  runEnded(run: RunRow, end: RunEnd): void
  housekeep(): void
}

export function handoverService(deps: HandOverDeps): HandoverService {
  const keeper = handoverHousekeeper(deps.store, deps.now, deps.log)
  return {
    deps,
    runEnded: (run, end) => handOverRunEnd(deps, run, end),
    housekeep: () => {
      keeper.passIfDue()
    }
  }
}
