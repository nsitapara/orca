import type { RunRow } from '../../shared/api-types'
import type { RunStore } from '../store/store-runs'
import { holderOf } from './hold'

// hold_home (Contract answers 2): Pilot's claim on the run's home for one step. Returns the reason another Pilot run holds
// it: the step's PILOT_HOME_BUSY, which its script passes to `pilotcli git update-branch --busy` (exit 3, skip). Null once
// the claim is recorded, for as long as the step runs.
export function holdHomeForStep(
  runs: RunStore,
  run: RunRow,
  idx: number,
  nameOf: (automationId: string) => string
): string | null {
  const home = run.homePath
  if (!home) {
    return null
  }
  const holder = holderOf(runs, home, run.id)
  if (holder) {
    return `${nameOf(holder.automationId)} is working in ${home} (Pilot run ${holder.id})`
  }
  runs.envs.holdHome(run.id, idx)
  return null
}
