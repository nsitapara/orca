import { useEffect, useRef, useState } from 'react'
import type { InboxItemRow } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'
import { answeredLine, countdown, phaseOf } from './answer-buttons'
import { queueNote } from './answer-text'

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

// What a saved answer says on the card, in one line: what it will do and how long until it does, with Undo
// only while it can still be taken back (settling or held); after that, what it is doing.
function lineText(
  item: InboxItemRow,
  queued: QueueEntry | null,
  phase: ReturnType<typeof phaseOf>,
  now: number
): string {
  const words = answeredLine(item)
  if (words.label === 'Skipped') {
    return 'Skipped'
  }
  if (phase === 'settling' && queued) {
    return `${words.label} in ${countdown(queued.readyAt - now)}`
  }
  if (phase === 'held' && queued) {
    return `${words.label} waiting · ${queueNote(queued, clock)}`
  }
  return words.doing
}

export function AnsweredLine({
  item,
  queued,
  focusUndo,
  onUndo
}: {
  item: InboxItemRow
  queued: QueueEntry | null
  // This click has just answered the card: move focus to Undo so the countdown is announced and reachable.
  focusUndo: boolean
  onUndo: () => void
}): React.JSX.Element {
  const now = useNow(queued?.state === 'not_ready')
  const phase = phaseOf(queued, now)
  const canUndo = phase !== 'applying'
  const undo = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusUndo && canUndo) {
      undo.current?.focus()
    }
  }, [focusUndo, canUndo])
  return (
    <div
      role="status"
      data-answered=""
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm"
    >
      <span>{lineText(item, queued, phase, now)}</span>
      {canUndo ? (
        <>
          <span className="text-muted-foreground">·</span>
          <button
            ref={undo}
            type="button"
            className="font-semibold text-[var(--ib-accent)] hover:underline"
            onClick={onUndo}
          >
            Undo
          </button>
        </>
      ) : null}
    </div>
  )
}
