import type { PilotContext } from '../pilot-services'
import { resolveChannelStep } from './run-channel'

// Where a call says it comes from: the CLI's terminal handle, and the env's step as the fallback.
export type CallBinding = { terminal?: string; runId?: string; stepIdx?: number }

// Whose powers apply (Task 22b ruling): the step starting or running on the caller's terminal, else the
// env's PILOT_RUN_ID/PILOT_STEP_IDX only while that step is active in an open run (run-channel's resolver,
// which refuses anything else). With neither the call is bound to no run (null).
export function runBinding(
  c: PilotContext,
  p: CallBinding
): { runId: string; stepIdx: number } | null {
  const bound = p.terminal ? c.store.runs.stepsOnTerminal(p.terminal) : []
  if (bound.length === 0 && p.runId === undefined && p.stepIdx === undefined) {
    return null
  }
  return resolveChannelStep(c, { terminal: p.terminal, runId: p.runId, stepIdx: p.stepIdx })
}
