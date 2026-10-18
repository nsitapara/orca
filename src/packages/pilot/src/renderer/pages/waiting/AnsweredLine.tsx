import { useEffect, useRef } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import { answeredLine, type Phase, phaseOf, undoLabel } from './answer-buttons'
import { countdown } from './answer-text'
import { useNow } from './use-now'

// What a saved answer says on the card, in one line. Only the server's `locked` says it is being carried out;
// until then it can be undone (or, once failed, changed).
function lineText(
  item: InboxListRow,
  state: AnswerState | null,
  phase: Phase,
  now: number
): string {
  const words = answeredLine(item)
  if (phase === 'failed') {
    return `Didn’t go through: ${state?.reason ?? 'no reason given'}`
  }
  if (words.label === 'Skipped' && phase !== 'applying') {
    return 'Skipped'
  }
  if (phase === 'settling' && state?.readyAt != null) {
    return `${words.label} in ${countdown(state.readyAt - now)}`
  }
  if (phase === 'sent') {
    return 'Answer sent before Pilot'
  }
  if (phase === 'held') {
    return `${words.label} waiting${state?.reason ? ` · ${state.reason}` : ''}`
  }
  if (phase === 'waiting') {
    return 'Waiting for Pilot to carry it out'
  }
  return words.doing
}

export function AnsweredLine({
  item,
  answerState,
  focusUndo,
  onUndo
}: {
  item: InboxListRow
  answerState: AnswerState | null
  // This click has just answered the card: move focus to the button so the countdown is announced.
  focusUndo: boolean
  onUndo: () => void
}): React.JSX.Element {
  const counting = answerState?.state === 'not_ready' && !answerState.locked
  const now = useNow(counting)
  const phase = phaseOf(answerState, now)
  const button = undoLabel(phase)
  const undo = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusUndo && button) {
      undo.current?.focus()
    }
  }, [focusUndo, button])
  return (
    <div
      role="status"
      data-answered=""
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm"
    >
      <span>{lineText(item, answerState, phase, now)}</span>
      {button ? (
        <>
          <span className="text-muted-foreground">·</span>
          <button
            ref={undo}
            type="button"
            className="font-semibold text-[var(--ib-accent)] hover:underline"
            onClick={onUndo}
          >
            {button}
          </button>
        </>
      ) : null}
    </div>
  )
}
