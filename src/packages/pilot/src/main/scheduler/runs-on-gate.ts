import type { AutomationDefinition } from '../../shared/definition/types'
import { sameMachine } from '../../shared/machine-match'

export type RunsOnGate = {
  ticksHere(def: Pick<AutomationDefinition, 'runsOn'>): boolean
  refusal(def: Pick<AutomationDefinition, 'runsOn'>): string | null
}

// machineName is a function so a rename takes effect on the next pass.
export function runsOnGate(opts: { machineName: () => string; pinnedOnly: boolean }): RunsOnGate {
  const refusal = (def: Pick<AutomationDefinition, 'runsOn'>): string | null => {
    const here = opts.machineName()
    if (def.runsOn === null) {
      return opts.pinnedOnly
        ? `it has no runs_on, and this Pilot ticks only jobs pinned to ${here}`
        : null
    }
    return sameMachine(def.runsOn, here) ? null : `it runs on ${def.runsOn}, not ${here}`
  }
  return { ticksHere: (def) => refusal(def) === null, refusal }
}
