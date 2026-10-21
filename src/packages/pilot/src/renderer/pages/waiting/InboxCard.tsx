import { useRef, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ActivityRun, InboxListRow, InboxReply } from '../../../shared/api-types'
import { isPlaceGroup } from '../../../shared/inbox-groups'
import type {
  AnswerState,
  CardHistoryEntry,
  PreparationWait,
  RunLine
} from '../../../shared/inbox-types'
import { MachineChip } from '../../hosts/MachineChip'
import { PilotHostProvider } from '../../hosts/PilotHostContext'
import { hostedKey, hostOf, type Hosted } from '../../hosts/pilot-host'
import { FromRun } from '../../run-views/FromRun'
import { PreparationProgress } from './PreparationProgress'
import { AnsweredLine } from './AnsweredLine'
import { AnswerRow } from './AnswerRow'
import type { Answer } from './answer-types'
import { approveWords } from './answer-buttons'
import { jobParts, runLineView } from './answer-text'
import { CardDetails } from './CardDetails'
import { CardPlace } from './CardPlace'
import { CardTimes, contentKeys, MessageHistory } from './MessageHistory'
import { DRAFTED_PILL_CLASS, type StatusPill, statusOf, statusPillClass } from './chips'
import { TicketedBeforeChip } from './TicketedBeforeChip'
import type { CardHome } from './use-inbox-sections'

// Who wrote a reply is stored with it (by), set by the path that wrote it; never guessed from its words.
function Reply({ reply }: { reply: InboxReply }): React.JSX.Element {
  if (reply.by === 'pilot') {
    return <p className="text-sm text-primary">Pilot: {reply.text}</p>
  }
  return <p className="text-sm">Agent asked: {reply.text}</p>
}

// The replies as lines, for an older Pilot that sends no Message history.
function BareReplies({ replies }: { replies: InboxReply[] }): React.JSX.Element {
  const keys = contentKeys(replies, (r) => `${r.by}:${r.text}`)
  return (
    <>
      {replies.map((r, i) => (
        <Reply key={keys[i]} reply={r} />
      ))}
    </>
  )
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

// The job line, under the card's place: the job's code and name, the card's age, then only what differs from plain
// waiting (drafted, the countdown state, applying, failed), and the card's own chips.
function JobLine({
  job,
  drafted,
  status,
  times,
  children
}: {
  job: string
  drafted: boolean
  status: StatusPill
  times: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { code, rest } = jobParts(job)
  return (
    <div data-job-line="" className="flex min-w-0 items-center gap-2">
      {code ? (
        <span className="shrink-0 rounded bg-muted px-1 font-mono text-2xs leading-[18px] font-semibold text-muted-foreground">
          {code}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={job}>
        {rest}
      </span>
      {times}
      {drafted ? <span className={DRAFTED_PILL_CLASS}>drafted</span> : null}
      {status === 'waiting' ? null : <span className={statusPillClass(status)}>{status}</span>}
      {children}
    </div>
  )
}

type InboxCardProps = {
  item: Hosted<InboxListRow>
  automationName: string
  // Where the card's work is (its section under Group by Worktree); null when that is unknown.
  home: CardHome | null
  // The section the card is listed under; null when it is shown on its own (One at a time).
  section: string | null
  // The run the card came from (InboxListPayload.runs), for its "From run" line; null when it has none.
  run: ActivityRun | null
  // An action card's Run line (InboxListPayload.runLines); null on any other card.
  runLine: RunLine | null
  // The server's lock and queue row for an answered card (InboxListPayload.answerStates).
  answerState: AnswerState | null
  // The card's Message history (InboxListPayload.history); null from an older Pilot, which shows the bare replies.
  history: CardHistoryEntry[] | null
  // Why a queued context card waits (InboxListPayload.preparationWaits); null when it does not or from an older Pilot.
  preparationWait: PreparationWait | null
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
  // Ticket for later filed this card's ticket.
  onTicketed: () => void
}

// Everything inside a card (its Details, its preparation request) asks the card's own machine.
export function InboxCard(props: InboxCardProps): React.JSX.Element {
  return (
    <PilotHostProvider host={hostOf(props.item)}>
      <CardBody {...props} />
    </PilotHostProvider>
  )
}

function CardBody({
  item,
  automationName,
  home,
  section,
  run,
  runLine,
  answerState,
  history,
  preparationWait,
  error,
  selected,
  now,
  onSave,
  onRetryPreparation,
  onPrepareEvidence,
  onTicketed
}: InboxCardProps): React.JSX.Element {
  const [unsaved, setUnsaved] = useState(false)
  // Set while the card is open: when it is answered from here the next line takes focus (not on page load).
  const justAnswered = useRef(item.status === 'open')
  // An open card is answered with one click; an answered one is a line with its countdown and Undo.
  const editing = item.status === 'open'
  if (editing) {
    justAnswered.current = true
  }
  const host = hostOf(item)
  const domId = `card-${hostedKey(host, item.id)}`
  const status = statusOf(item, answerState, unsaved && editing)
  const ticketed = item.ticketedBefore ? <TicketedBeforeChip ticket={item.ticketedBefore} /> : null
  const frame = cn(
    'flex min-w-0 scroll-mt-14 flex-col gap-2 rounded-[10px] border bg-card px-3.5 py-3 text-card-foreground',
    selected ? 'border-foreground/30' : 'border-border'
  )
  if (!editing) {
    return (
      <article id={domId} data-selected={selected ? '' : undefined} className={frame}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</h3>
          <span className={statusPillClass(status)}>{status}</span>
          {ticketed}
          <MachineChip host={host} />
        </div>
        <PreparationProgress
          item={item}
          onRetry={onRetryPreparation}
          onPrepareEvidence={onPrepareEvidence}
          wait={preparationWait}
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
  // Under its own worktree's heading the card leaves the place to the heading.
  const place = home && home.key !== section && isPlaceGroup(home.group) ? home : null
  return (
    <article id={domId} data-selected={selected ? '' : undefined} className={frame}>
      {place ? <CardPlace home={place} /> : null}
      <JobLine
        job={automationName}
        drafted={item.details?.drafted === true}
        status={status}
        times={<CardTimes createdAt={item.createdAt} history={history} now={now} />}
      >
        {ticketed}
        <MachineChip host={host} />
      </JobLine>
      <FromRun item={item} run={run} place={home?.group.label ?? null} />
      <PreparationProgress
        item={item}
        onRetry={onRetryPreparation}
        onPrepareEvidence={onPrepareEvidence}
        wait={preparationWait}
      />
      <h3 className="text-[15px] font-semibold">{item.title}</h3>
      {item.context ? <p className="text-sm text-muted-foreground">{item.context}</p> : null}
      {item.suggested ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested:</span> {item.suggested}
        </p>
      ) : null}
      <RunLineBlock line={runLine} digest={item.digest} button={approveWords(item).label} />
      <CardDetails item={item} />
      {history ? <MessageHistory item={item} entries={history} now={now} /> : null}
      {history ? null : <BareReplies replies={item.replies} />}
      <AnswerRow item={item} onSave={onSave} onPick={setUnsaved} onTicketed={onTicketed} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </article>
  )
}
