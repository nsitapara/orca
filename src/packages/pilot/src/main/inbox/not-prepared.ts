import type { InboxItemRow } from '../../shared/api-types'
import type { InboxAddParams } from '../../shared/inbox-types'
import { PREPARATION_REFUSED, PreparationInputSchema } from '../../shared/preparation'
import { answerLocked } from './answer-lock'
import { inboxEvent, syncRunWaiting, WAITING, type InboxDeps } from './inbox-service'

export const NOT_PREPARED_SHAPE =
  'A "Not prepared" card is a flagged notice: no action, parts, switch or preparation request'

// A preparation request's own shape and size, checked before anything else about the card. Its refusal starts
// with PREPARATION_REFUSED, so the bridge falls back to a "Not prepared" card only for it (D2).
export function checkPreparationRequest(params: InboxAddParams): void {
  if (!params.preparation) {
    return
  }
  const parsed = PreparationInputSchema.safeParse(params.preparation)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('.') || 'request'
    throw new Error(`${PREPARATION_REFUSED}: ${where}: ${issue?.message ?? 'invalid'}`)
  }
}

// D2's fallback runs nothing: a flagged notice with no action, parts or switch, and no request of its own.
export function checkNotPrepared(params: InboxAddParams): void {
  if (!params.notPrepared) {
    return
  }
  const { action, actionArgs, parts, switchWords, preparation, type } = params
  const carries = [action, actionArgs, preparation].some((x) => x !== undefined)
  const extras = Object.keys(parts ?? {}).length > 0 || (switchWords ?? []).length > 0
  if (type !== 'flagged' || carries || extras) {
    throw new Error(NOT_PREPARED_SHAPE)
  }
}

// An action whose Approve runs with no agent in between (push, post_review) is offered by a run only prepared:
// its evidence is verified before Approve can run it. A card outside a run (an imported one) is as before.
export function refuseUnpreparedEvidence(
  deps: InboxDeps,
  params: InboxAddParams,
  runId: string | null,
  action: string | null
): void {
  if (runId && action && !params.preparation && deps.actionNeedsEvidence?.(action)) {
    throw new Error(
      `${action} needs prepared evidence: offer it with a preparation request (--preparation-file)`
    )
  }
}

// The prepared card for a key retires the waiting "Not prepared" notices that stood in for it, in its own write.
export function retireNotPrepared(
  deps: InboxDeps,
  waiting: InboxItemRow[],
  key: string,
  replacement: string,
  at: number
): void {
  for (const notice of waiting) {
    if (
      notice.notPreparedKey !== key ||
      !WAITING.includes(notice.status) ||
      answerLocked(deps.store, notice, at)
    ) {
      continue
    }
    const outcome = `superseded: prepared as ${replacement}`
    deps.store.inbox.update(notice.id, { status: 'obsolete', outcome }, at)
    deps.store.queue.removePending(notice.id)
    inboxEvent(deps.store, notice, 'item_ticked', { status: 'obsolete', outcome }, at)
    syncRunWaiting(deps.store, notice.runId, at)
  }
}
