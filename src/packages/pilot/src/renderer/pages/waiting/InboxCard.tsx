import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import type { InboxItemRow, InboxReply } from '../../../shared/api-types'
import type { QueueEntry, RunLine } from '../../../shared/inbox-types'
import {
  choicesFor,
  type Choice,
  composeAnswer,
  KIND_LABEL,
  QUEUE_PILL,
  queueNote,
  runLineView,
  worktreeName
} from './answer-text'
import { CardDetails } from './CardDetails'
import type { PartSwitches } from '../../details/ReviewBlock'

type Answer = { option: number | null; text: string }

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Parts({
  item,
  off,
  onToggle
}: {
  item: InboxItemRow
  off: string[]
  onToggle: (id: string) => void
}): React.JSX.Element {
  const onWord = item.switchWords[0] ?? 'Include'
  const offWord = item.switchWords[1] ?? 'Leave out'
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {Object.entries(item.parts).map(([id, label]) => (
        <li key={id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!off.includes(id)}
            onChange={() => onToggle(id)}
            aria-label={`${onWord} ${id}`}
          />
          <span className="font-mono text-xs text-muted-foreground">{id}</span>
          <span>{label}</span>
          {off.includes(id) ? <Badge variant="outline">{offWord}</Badge> : null}
        </li>
      ))}
    </ul>
  )
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
      {pill ? (
        <Badge variant={pill.variant}>{pill.label}</Badge>
      ) : (
        <Badge variant="secondary">Sent to its session</Badge>
      )}
      {queued && pill ? (
        <span className="text-muted-foreground">
          {queued.fires} · {queueNote(queued, clock)}
        </span>
      ) : null}
      <span className="flex-1" />
      <Button size="xs" variant="ghost" onClick={onChange}>
        Change answer
      </Button>
    </div>
  )
}

function AnswerForm({
  item,
  off,
  onToggle,
  onSave,
  onSaved
}: {
  item: InboxItemRow
  off: string[]
  onToggle: (id: string) => void
  onSave: (answer: Answer) => Promise<string | null>
  onSaved: () => void
}): React.JSX.Element {
  const choices = choicesFor(item)
  const [picked, setPicked] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const choice = picked === null ? null : choices[picked]
  const answer = choice ? composeAnswer(item, choice, notes, off) : null
  const save = async () => {
    if (!answer) {
      return
    }
    setSaving(true)
    const failed = await onSave(answer)
    setSaving(false)
    if (!failed) {
      onSaved()
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" className="flex flex-col gap-1">
        {choices.map((c, i) => (
          <label key={c.label} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`answer-${item.id}`}
              value={c.label}
              checked={picked === i}
              onChange={() => setPicked(i)}
            />
            <span>
              <span className="font-medium">{c.label}</span>
              {c.meaning ? <span className="text-muted-foreground"> — {c.meaning}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {choice && choice.notes !== 'none' ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={notesPlaceholder(choice)}
        />
      ) : null}
      {Object.keys(item.parts).length > 0 && choice?.label === 'Approve' ? (
        <Parts item={item} off={off} onToggle={onToggle} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1" />
        <Button size="sm" data-save="" disabled={!answer || saving} onClick={() => void save()}>
          Save answer
        </Button>
      </div>
    </div>
  )
}

function notesPlaceholder(choice: Choice): string {
  if (choice.notes === 'optional') {
    return 'Anything the run should know (optional)'
  }
  return 'What should happen instead?'
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
      className="flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/5 px-3 py-2"
    >
      <span className="text-xs font-medium text-primary">Pilot · Approve runs</span>
      <code className="font-mono text-xs break-all">{head}</code>
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
        <pre className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">{text}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function InboxCard({
  item,
  automationName,
  runLine,
  queued,
  error,
  onSave
}: {
  item: InboxItemRow
  automationName: string
  // An action card's Run line (InboxListPayload.runLines); null on any other card.
  runLine: RunLine | null
  queued: QueueEntry | null
  // Why the last save failed; held by the page so it survives the card remounting as a new version.
  error: string | null
  onSave: (answer: Answer) => Promise<string | null>
}): React.JSX.Element {
  const [editing, setEditing] = useState(item.status === 'open')
  const [off, setOff] = useState<string[]>([])
  const toggle = (id: string) =>
    setOff((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  const parts = editing ? partSwitches(item, off, toggle) : null
  return (
    <article className="min-w-0">
      <Card className="min-w-0 gap-3 py-4">
        <CardContent className="flex min-w-0 flex-col gap-2 px-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{KIND_LABEL[item.type]}</Badge>
            <span>from {automationName}</span>
            <span className="flex-1" />
            <span>{worktreeName(item.worktreePath)}</span>
          </div>
          <p className="text-sm font-medium">{item.title}</p>
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
          <CardBody
            item={item}
            editing={editing}
            off={off}
            onToggle={toggle}
            queued={queued}
            onSave={onSave}
            setEditing={setEditing}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </article>
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

function CardBody({
  item,
  editing,
  off,
  onToggle,
  queued,
  onSave,
  setEditing
}: {
  item: InboxItemRow
  editing: boolean
  off: string[]
  onToggle: (id: string) => void
  queued: QueueEntry | null
  onSave: (answer: Answer) => Promise<string | null>
  setEditing: (editing: boolean) => void
}): React.JSX.Element {
  if (editing) {
    return (
      <AnswerForm
        item={item}
        off={off}
        onToggle={onToggle}
        onSave={onSave}
        onSaved={() => setEditing(false)}
      />
    )
  }
  return <Saved item={item} queued={queued} onChange={() => setEditing(true)} />
}
