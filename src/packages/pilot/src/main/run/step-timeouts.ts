import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'

// Contract §7: the step's own timeout, else limits.timeout, else none.
export function stepTimeoutMs(def: AutomationDefinition, idx: number): number | null {
  return def.steps[idx]?.timeoutMs ?? def.limits.timeoutMs ?? null
}

// An answers session (Task 24b) with no limits.timeout: past this its tab is closed, so a stuck one
// can't hold its worktree's answers for ever.
export const ANSWER_STEP_TIMEOUT_MS = 60 * 60_000

// Task 9c ruling: an answer run's one step isn't a definition step, so it never takes the timeout of
// the step at its index: limits.timeout, else ANSWER_STEP_TIMEOUT_MS.
export function runStepTimeoutMs(
  def: AutomationDefinition,
  run: Pick<RunRow, 'trigger'>,
  idx: number
): number | null {
  if (run.trigger === 'answer') {
    return def.limits.timeoutMs ?? ANSWER_STEP_TIMEOUT_MS
  }
  return stepTimeoutMs(def, idx)
}
