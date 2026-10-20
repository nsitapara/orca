import { z } from 'zod'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { resolveChannelStep } from './run-channel'

// Where a call says it comes from: the CLI's terminal handle, and the env's step as the fallback.
export type CallBinding = { terminal?: string; runId?: string; stepIdx?: number }
// Its params, for a method that refuses an agent in a run (refuseAgentCaller).
export const CallerBinding = {
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
}

// Whose powers apply (Task 22b ruling): the step starting, running or detached on the caller's terminal, else the
// env's PILOT_RUN_ID/PILOT_STEP_IDX only while that step is active in an open run or detached (run-channel's resolver,
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

export const NO_CALLER_CHANGE = "Pilot can't tell who is calling; nothing was changed"
export const AGENT_IN_RUN =
  "An agent in a Pilot run can't tick, enable or pause an automation; Nish does that in Pilot"

// Ticking or flipping an automation is Nish's call (R15). The transport's stamp says who calls (never a
// param): no identity is refused; the desktop and a paired device are a person. The local CLI is shared by
// Nish and every agent, so it is refused when its call is bound to a run (the step on its terminal, else
// the env's step) and, failing closed, when the env names a run that can't be resolved.
export function refuseAgentCaller(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  binding: CallBinding,
  refusal = AGENT_IN_RUN
): void {
  if (!caller) {
    throw new Error(NO_CALLER_CHANGE)
  }
  if (caller.kind !== 'local-cli') {
    return
  }
  let bound: { runId: string; stepIdx: number } | null
  try {
    bound = runBinding(c, binding)
  } catch (error) {
    throw new Error(`${refusal} (${error instanceof Error ? error.message : String(error)})`)
  }
  if (bound) {
    throw new Error(`${refusal} (run ${bound.runId}, step ${bound.stepIdx})`)
  }
}
