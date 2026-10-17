import { useRef, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ActivityRun, InboxListRow, InboxReply } from '../../../shared/api-types'
import type { AnswerState, RunLine } from '../../../shared/inbox-types'
import type { PartSwitches } from '../../details/ReviewBlock'
import { FromRun } from '../../run-views/FromRun'
import { PreparationProgress } from './PreparationProgress'
import { AnsweredLine } from './AnsweredLine'
import { AnswerRow } from './AnswerRow'
import type { Answer } from './answer-types'
import { approveWords } from './answer-buttons'
import { askedLabel, runLineView } from './answer-text'
import { CardDetails } from './CardDetails'
import { DRAFTED_PILL_CLASS, type StatusPill, statusOf, statusPillClass } from './chips'

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
  digest,
  button
}: {
  line: RunLine | null
  digest: string
  // The label of the button that runs it ("Push to origin").
  button: string
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
      <span className="text-[11.5px] font-semibold text-primary">Pilot · {button} runs</span>
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
  item: InboxListRow,
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

// The line above the title: job code and name, when it was asked and how long ago, small and muted, on one
// line; on its right only what differs from plain waiting (drafted, the countdown state, applying, failed).
function Eyebrow({
  job,
  asked,
  drafted,
  status
}: {
  job: string
  asked: ReturnType<typeof askedLabel>
  drafted: boolean
  status: StatusPill
}): React.JSX.Element {
  const full = `${job} · ${asked.when}${asked.relative ? ` · ${asked.relative}` : ''}`
  return (
    <div
      data-eyebrow=""
      className="flex items-center gap-2 text-[11.5px] tracking-[0.04em] text-muted-foreground uppercase"
    >
      <span className="min-w-0 flex-1 truncate" title={full}>
        {job} · <span title={asked.full}>{asked.when}</span>
        {asked.relative ? ` · ${asked.relative}` : null}
      </span>
      {drafted ? <span className={DRAFTED_PILL_CLASS}>drafted</span> : null}
      {status === 'waiting' ? null : <span className={statusPillClass(status)}>{status}</span>}
    </div>
  )
}

export function InboxCard({
  item,
  automationName,
  run,
  runLine,
  answerState,
  error,
  selected,
  now,
  onSave,
  onRetryPreparation,
  onPrepareEvidence
}: {
  item: InboxListRow
  automationName: string
  // The run the card came from (InboxListPayload.runs), for its "From run" line; null when it has none.
  run: ActivityRun | null
  // An action card's Run line (InboxListPayload.runLines); null on any other card.
  runLine: RunLine | null
  // The server's lock and queue row for an answered card (InboxListPayload.answerStates).
  answerState: AnswerState | null
  // Why the last save failed; held by the page so it survives the card remounting as a new version.
  error: string | null
  // The card picked in the list: a lighter border.
  selected: boolean
  // The clock the card's age is read against (when the list was loaded).
  now: number
  onSave: (answer: Answer) => Promise<string | null>
  // Retry on a blocked preparation: null once requeued, else why not.
  onRetryPreparation: () => Promise<string | null>
  // Prepare evidence on a never-prepared push or drafted card: null once queued, else why not.
  onPrepareEvidence: () => Promise<string | null>
}): React.JSX.Element {
  const [unsaved, setUnsaved] = useState(false)
  // Set while the card is open: when it is answered from here the next line takes focus (not on page load).
  const justAnswered = useRef(item.status === 'open')
  const [off, setOff] = useState<string[]>([])
  const toggle = (id: string) =>
    setOff((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  // An open card is answered with one click; an answered one is a line with its countdown and Undo.
  const editing = item.status === 'open'
  if (editing) {
    justAnswered.current = true
  }
  const parts = editing ? partSwitches(item, off, toggle) : null
  const asked = askedLabel(item.createdAt, now)
  const status = statusOf(item, answerState, unsaved && editing)
  const frame = cn(
    'flex min-w-0 scroll-mt-14 flex-col gap-2 rounded-[10px] border bg-card px-3.5 py-3 text-card-foreground',
    selected ? 'border-foreground/30' : 'border-border'
  )
  if (!editing) {
    return (
      <article id={`card-${item.id}`} data-selected={selected ? '' : undefined} className={frame}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</h3>
          <span className={statusPillClass(status)}>{status}</span>
        </div>
        <PreparationProgress
          item={item}
          onRetry={onRetryPreparation}
          onPrepareEvidence={onPrepareEvidence}
        />
        <AnsweredLine
          item={item}
          answerState={answerState}
          focusUndo={justAnswered.current}
          onUndo={() => void onSave({ option: null, text: '' })}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </article>
    )
  }
  return (
    <article id={`card-${item.id}`} data-selected={selected ? '' : undefined} className={frame}>
      <Eyebrow
        job={automationName}
        asked={asked}
        drafted={item.details?.drafted === true}
        status={status}
      />
      <FromRun item={item} run={run} />
      <PreparationProgress
        item={item}
        onRetry={onRetryPreparation}
        onPrepareEvidence={onPrepareEvidence}
      />
      <h3 className="text-[15px] font-semibold">{item.title}</h3>
      {item.context ? <p className="text-sm text-muted-foreground">{item.context}</p> : null}
      {item.suggested ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested:</span> {item.suggested}
        </p>
      ) : null}
      <RunLineBlock line={runLine} digest={item.digest} button={approveWords(item).label} />
      <CardDetails item={item} parts={parts} />
      {item.replies.map((r, i) => (
        <Reply key={i} reply={r} />
      ))}
      <AnswerRow item={item} off={off} onToggle={toggle} onSave={onSave} onPick={setUnsaved} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </article>
  )
}
