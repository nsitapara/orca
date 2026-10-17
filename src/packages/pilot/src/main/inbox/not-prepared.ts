import type { InboxItemRow } from '../../shared/api-types'
import type { InboxAddParams } from '../../shared/inbox-types'
import { EVIDENCE_ACTIONS } from '../../shared/evidence'
import { PREPARATION_REFUSED, PreparationInputSchema } from '../../shared/preparation'
import { answerLocked } from './answer-lock'
import { inboxEvent, syncRunWaiting, type InboxDeps } from './inbox-service'

export const NOT_PREPARED_NOTICE_ONLY =
  'A "Not prepared" card is a flagged notice: no action, parts, switch, Details bundle or preparation request'

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
  const { action, actionArgs, parts, switchWords, preparation, type, detailsBundlePath } = params
  const carries = [action, actionArgs, preparation, detailsBundlePath].some((x) => x !== undefined)
  const extras = Object.keys(parts ?? {}).length > 0 || (switchWords ?? []).length > 0
  if (type !== 'flagged' || carries || extras) {
    throw new Error(NOT_PREPARED_NOTICE_ONLY)
  }
}

// R-P5 at add: an action whose Approve runs with no agent in between (push) is offered only with a
// preparation request, whoever adds it and however the caller is bound. An imported card is the one exception: it
// comes in as "Needs evidence", and nothing runs from it until a person prepares it.
export function refuseUnpreparedEvidence(
  params: InboxAddParams,
  source: InboxItemRow['source'] | undefined
): void {
  const action = params.action
  if (source !== 'import' && action && !params.preparation && EVIDENCE_ACTIONS.has(action)) {
    throw new Error(
      `${action} needs prepared evidence: offer it with a preparation request (--preparation-file)`
    )
  }
}

// The prepared card for a key retires the open "Not prepared" notices that stood in for it, in its own write: only
// when a run adds it (never an add from outside one), and only its own item's notices (the run's automation, item and
// worktree). A notice already answered, or any other card, is never touched.
export function retireNotPrepared(
  deps: InboxDeps,
  cards: InboxItemRow[],
  origin: { runId: string | null; itemKey: string | null; worktreePath: string | null },
  key: string,
  replacement: string,
  at: number
): void {
  if (!origin.runId) {
    return
  }
  for (const notice of cards) {
    if (
      notice.notPreparedKey !== key ||
      notice.status !== 'open' ||
      notice.itemKey !== origin.itemKey ||
      notice.worktreePath !== origin.worktreePath ||
      notice.action !== null ||
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
