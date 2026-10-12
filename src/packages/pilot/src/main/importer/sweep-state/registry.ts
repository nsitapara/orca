import { noStateMapper } from './plans'
import type { SweepStateMapper } from './types'

// One entry per ported job; each port task appends its own. Mappers import their helpers from plans.ts,
// never from here, so there is no import cycle.
export const MAPPERS: SweepStateMapper[] = [
  noStateMapper('pull-dev', '01 keeps no state: every run pulls dev again')
]

export function sweepStateMapper(
  id: string,
  mappers: SweepStateMapper[] = MAPPERS
): SweepStateMapper | null {
  return mappers.find((m) => m.automationId === id) ?? null
}

export function sweepStateIds(mappers: SweepStateMapper[] = MAPPERS): string[] {
  return mappers.map((m) => m.automationId).sort()
}
