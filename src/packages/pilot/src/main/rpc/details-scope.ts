import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { runBinding, type CallBinding } from './run-binding'

export const DETAILS_RUN_ONLY =
  "Attach Details from a Pilot run's step, for a card of that run's automation"
export const DETAILS_OWN_AUTOMATION = 'This run belongs to another automation than the card'
export const DETAILS_NO_CALLER_CHANGE = "Pilot can't tell who is calling; nothing was changed"

// Who may give a card a bundle (ruling 4), from the transport's stamp only: the desktop, or the local CLI
// bound to a run (the step on its terminal, else the env's active step) of the card's own automation. A
// binding that can't be resolved fails closed; a paired device, an unnamed or unknown caller is refused.
// An add with --details-bundle (which can change an open card) asks it. Returns the run the call is bound to
// (null for the desktop), so the change can tell the card's own answer run from another.
export function refuseOutsideScope(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  binding: CallBinding,
  automationId: string
): string | null {
  if (!caller) {
    throw new Error(DETAILS_NO_CALLER_CHANGE)
  }
  if (caller.kind === 'desktop') {
    return null
  }
  if (caller.kind !== 'local-cli') {
    throw new Error(DETAILS_RUN_ONLY)
  }
  let bound: { runId: string; stepIdx: number } | null
  try {
    bound = runBinding(c, binding)
  } catch (error) {
    throw new Error(
      `${DETAILS_RUN_ONLY} (${error instanceof Error ? error.message : String(error)})`
    )
  }
  if (!bound) {
    throw new Error(DETAILS_RUN_ONLY)
  }
  if (c.store.runs.get(bound.runId)?.automationId !== automationId) {
    throw new Error(DETAILS_OWN_AUTOMATION)
  }
  return bound.runId
}
