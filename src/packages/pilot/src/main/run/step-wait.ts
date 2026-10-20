import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'

// Whether the step at `idx` ends once its session is up (wait: start). An answer run's step isn't a definition step.
export function endsAtStart(
  def: AutomationDefinition | null,
  run: Pick<RunRow, 'trigger'>,
  idx: number
): boolean {
  if (!def || run.trigger === 'answer') {
    return false
  }
  return def.steps[idx]?.wait === 'start'
}
