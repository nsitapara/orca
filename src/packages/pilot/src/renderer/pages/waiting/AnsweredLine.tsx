import { useEffect, useState } from 'react'
import type { InboxItemRow } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'
import { answeredLine, countdown } from './answer-buttons'
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
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

// Can the answer still be taken back? Until the queue has dispatched it.
function undoable(queued: QueueEntry | null): boolean {
  return queued !== null && queued.state !== 'dispatched' && queued.state !== 'failed'
}

// What a saved answer says on the card, in one line: what it will do and how long until it does, with Undo
// while it can still be taken back; after that, what it is doing.
function lineText(item: InboxItemRow, queued: QueueEntry | null, now: number): string {
  const words = answeredLine(item)
  if (words.label === 'Skipped') {
    return 'Skipped'
  }
  if (queued?.state === 'failed') {
    return `${words.label} didn't go through`
  }
  if (queued?.state === 'not_ready' && queued.readyAt > now) {
    return `${words.label} in ${countdown(queued.readyAt - now)}`
  }
  if (queued?.state === 'held') {
    return `${words.doing} · ${queueNote(queued, clock)}`
  }
  return words.doing
}

export function AnsweredLine({
  item,
  queued,
  onUndo
}: {
  item: InboxItemRow
  queued: QueueEntry | null
  onUndo: () => void
}): React.JSX.Element {
  const counting = queued?.state === 'not_ready'
  const now = useNow(counting)
  return (
    <div
      data-answered=""
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm"
    >
      <span>{lineText(item, queued, now)}</span>
      {undoable(queued) ? (
        <>
          <span className="text-muted-foreground">·</span>
          <button
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
