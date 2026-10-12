import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { InboxItemRow, InboxReply } from '../../../shared/api-types'
import type { QueueEntry, RunLine } from '../../../shared/inbox-types'
import type { PartSwitches } from '../../details/ReviewBlock'
import { AnswerRow } from './AnswerRow'
import type { Answer } from './answer-types'
import { KIND_LABEL, QUEUE_PILL, queueNote, runLineView } from './answer-text'
import { CardDetails } from './CardDetails'
import {
  DRAFTED_PILL_CLASS,
  JOB_CHIP_CLASS,
  kindChipClass,
  statusOf,
  statusPillClass
} from './chips'

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Saved({
  item,
  queued,
  onChange
}: {
  item: InboxItemRow
  queued: QueueEntry | null
  onChange: () => void
}): React.JSX.Element {
  const pill =
    queued && queued.state !== 'dispatched' && queued.state !== 'failed'
      ? QUEUE_PILL[queued.state]
      : null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm">
      <span>Saved: {item.answer?.text}</span>
      <span className="rounded border px-1.5 text-xs">
        {pill ? pill.label : 'Sent to its session'}
      </span>
      {queued && pill ? (
        <span className="text-muted-foreground">
          {queued.fires} · {queueNote(queued, clock)}
        </span>
      ) : null}
      <span className="flex-1" />
      <button
        type="button"
        className="rounded px-2 py-0.5 text-xs hover:bg-muted"
        onClick={onChange}
      >
        Change answer
      </button>
    </div>
  )
}

// Who wrote a reply is stored with it (by), set by the path that wrote it; never guessed from its words.
function Reply({ reply }: { reply: InboxReply }): React.JSX.Element {
  if (reply.by === 'pilot') {
    return <p className="text-sm text-primary">Pilot: {reply.text}</p>
  }
  return <p className="text-sm">Agent asked: {reply.text}</p>
}

// What approving an action card runs, as Pilot wrote it from the stored card: a Pilot block of its own,
// apart from the agent's words, shown only for the card version it was built for. Never cut silently.
function RunLineBlock({
  line,
  digest
}: {
  line: RunLine | null
  digest: string
}): React.JSX.Element | null {
  if (!line || line.digest !== digest) {
    return null
  }
  const { head, more } = runLineView(line.text)
  return (
    <div
      data-pilot-run-line=""
      className="flex flex-col gap-0.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5"
    >
      <span className="text-[11.5px] font-semibold text-primary">Pilot · Approve runs</span>
      <code className="font-mono text-[11.5px] leading-[1.5] break-all">{head}</code>
      {more > 0 ? <RunLineRest text={line.text} more={more} /> : null}
    </div>
  )
}

function RunLineRest({ text, more }: { text: string; more: number }): React.JSX.Element {
  return (
    <Collapsible>
      <span className="text-xs text-muted-foreground">… ({more} more chars)</span>{' '}
      <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
        Show the whole command
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 font-mono text-[11.5px] break-all whitespace-pre-wrap">{text}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function partSwitches(
  item: InboxItemRow,
  off: string[],
  toggle: (id: string) => void
): PartSwitches | null {
  if (Object.keys(item.parts).length === 0) {
    return null
  }
  const words: [string, string] = [
    item.switchWords[0] ?? 'Include',
    item.switchWords[1] ?? 'Leave out'
  ]
  return { off, toggle, words }
}

export function InboxCard({
  item,
  automationName,
  runLine,
  queued,
  error,
  selected,
  onSave
}: {
  item: InboxItemRow
  automationName: string
  // An action card's Run line (InboxListPayload.runLines); null on any other card.
  runLine: RunLine | null
  queued: QueueEntry | null
  // Why the last save failed; held by the page so it survives the card remounting as a new version.
  error: string | null
  // The card picked in the list: a lighter border.
  selected: boolean
  onSave: (answer: Answer) => Promise<string | null>
}): React.JSX.Element {
  const [editing, setEditing] = useState(item.status === 'open')
  const [unsaved, setUnsaved] = useState(false)
  const [off, setOff] = useState<string[]>([])
  const toggle = (id: string) =>
    setOff((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  const parts = editing ? partSwitches(item, off, toggle) : null
  const status = statusOf(item, queued, unsaved && editing)
  return (
    <article
      id={`card-${item.id}`}
      data-selected={selected ? '' : undefined}
      className={cn(
        'flex min-w-0 scroll-mt-14 flex-col gap-2 rounded-[10px] border bg-card px-3.5 py-3 text-card-foreground',
        selected ? 'border-foreground/30' : 'border-border'
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={kindChipClass(item.type)}>{KIND_LABEL[item.type]}</span>
        <span className={JOB_CHIP_CLASS}>{automationName}</span>
        {item.details?.drafted ? <span className={DRAFTED_PILL_CLASS}>drafted</span> : null}
        <span className={statusPillClass(status)}>{status}</span>
      </div>
      <h3 className="text-[15px] font-semibold">{item.title}</h3>
      {item.context ? <p className="text-sm text-muted-foreground">{item.context}</p> : null}
      {item.suggested ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested:</span> {item.suggested}
        </p>
      ) : null}
      <RunLineBlock line={runLine} digest={item.digest} />
      <CardDetails item={item} parts={parts} />
      {item.replies.map((r, i) => (
        <Reply key={i} reply={r} />
      ))}
      {editing ? (
        <AnswerRow
          item={item}
          off={off}
          onToggle={toggle}
          onSave={onSave}
          onSaved={() => {
            setEditing(false)
            setUnsaved(false)
          }}
          onPick={setUnsaved}
        />
      ) : (
        <Saved
          item={item}
          queued={queued}
          onChange={() => {
            setUnsaved(false)
            setEditing(true)
          }}
        />
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </article>
  )
}
