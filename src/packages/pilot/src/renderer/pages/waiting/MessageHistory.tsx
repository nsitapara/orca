import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { InboxListRow } from '../../../shared/api-types'
import type { CardHistoryEntry, HistoryRun } from '../../../shared/inbox-types'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { openRun } from '../../run-views/run-panel-state'
import { RUN_TONE } from '../../run-views/tokens'
import { runStatusLabel } from '../format'
import { answerWords } from './answer-buttons'
import { askedLabel } from './answer-text'

type Entry<K extends CardHistoryEntry['kind']> = Extract<CardHistoryEntry, { kind: K }>

const LABEL = 'text-2xs font-semibold tracking-[0.05em] uppercase'

// "…answer-16" for review-branch-code-202610171836-answer-16; the whole id is the Open run's title.
function shortRun(id: string): string {
  const parts = id.split('-')
  return parts.length > 2 ? `…${parts.slice(-2).join('-')}` : id
}

function When({ at, now }: { at: number; now: number }): React.JSX.Element {
  const asked = askedLabel(at, now)
  return <span title={asked.full}>{asked.when}</span>
}

function Stamp({ label, at, now }: { label: string; at: number; now: number }): React.JSX.Element {
  const asked = askedLabel(at, now)
  return (
    <span>
      <span className={LABEL}>{label}</span>{' '}
      <span className="font-medium text-foreground" title={asked.full}>
        {asked.when}
      </span>
      {asked.relative ? ` · ${asked.relative}` : null}
    </span>
  )
}

// Under the job name: when the card was made and, once the agent has written back, when it last did.
export function CardTimes({
  createdAt,
  history,
  now
}: {
  createdAt: number
  history: CardHistoryEntry[] | null
  now: number
}): React.JSX.Element {
  const replied = history?.findLast((e) => e.kind === 'reply' && e.by === 'agent' && e.at !== null)
  return (
    <div
      data-card-times=""
      className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground"
    >
      <Stamp label="Created" at={createdAt} now={now} />
      {replied?.at ? <Stamp label="Agent replied" at={replied.at} now={now} /> : null}
    </div>
  )
}

// The history's runs are the card's machine's.
function OpenRun({ run }: { run: HistoryRun }): React.JSX.Element | null {
  const host = usePilotHost()
  if (run.status === null) {
    return null
  }
  return (
    <button
      type="button"
      className="underline underline-offset-4 hover:text-foreground"
      title={run.id}
      onClick={() => openRun(run.id, null, host)}
    >
      Open run
    </button>
  )
}

function RunLine({ entry, now }: { entry: Entry<'asked' | 'prepared'>; now: number }) {
  const what = entry.kind === 'asked' ? 'asked' : 'context prepared'
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <span className="min-w-0 truncate">
        <When at={entry.at} now={now} /> · {what}
        {entry.run ? ` by run ${shortRun(entry.run.id)}` : null}
      </span>
      {entry.run ? <OpenRun run={entry.run} /> : null}
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
    </div>
  )
}

function YourAnswer({
  item,
  entry,
  now
}: {
  item: InboxListRow
  entry: Entry<'answer'>
  now: number
}) {
  // A button's word reads as its button did; notes read as written.
  const word = entry.text.trim().toLowerCase()
  const button = word === 'approve' || word === 'skip'
  const others = entry.with.map((title) => `“${title}”`).join(', ')
  return (
    <div data-message="you" className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          <When at={entry.at} now={now} />
          {button ? null : ' · note'}
        </span>
        <span className={cn(LABEL, 'text-[var(--ib-accent)]')}>You</span>
      </div>
      <p className="rounded-xl rounded-br-sm bg-[var(--ib-accent-soft)] px-3 py-2 text-sm whitespace-pre-wrap">
        {button ? answerWords(item, entry.text).label : entry.text}
      </p>
      {entry.run ? (
        <span
          className="max-w-full truncate font-mono text-xs text-muted-foreground"
          title={others ? `with ${others}` : undefined}
        >
          sent to answer run {shortRun(entry.run.id)}
          {others ? ` with ${others}` : null}
        </span>
      ) : null}
    </div>
  )
}

function Reply({ entry, now }: { entry: Entry<'reply'>; now: number }): React.JSX.Element {
  return (
    <div
      data-message={entry.by}
      className="flex max-w-[85%] flex-col items-start gap-1.5 self-start"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={cn(LABEL, entry.by === 'pilot' && 'text-primary')}>
          {entry.by === 'agent' ? 'Agent' : 'Pilot'}
        </span>
        {entry.at !== null ? <When at={entry.at} now={now} /> : null}
        {entry.run ? <span className="font-mono">answer run {shortRun(entry.run.id)}</span> : null}
        {entry.run?.status ? (
          <span className={cn('rounded px-1.5', RUN_TONE[entry.run.status])}>
            {runStatusLabel(entry.run.status)}
          </span>
        ) : null}
        {entry.run ? <OpenRun run={entry.run} /> : null}
      </div>
      <p className="rounded-xl rounded-bl-sm border border-border bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {entry.text}
      </p>
    </div>
  )
}

function Line({ item, entry, now }: { item: InboxListRow; entry: CardHistoryEntry; now: number }) {
  switch (entry.kind) {
    case 'asked':
    case 'prepared':
      return <RunLine entry={entry} now={now} />
    case 'answer':
      return <YourAnswer item={item} entry={entry} now={now} />
    case 'reply':
      return <Reply entry={entry} now={now} />
  }
}

// The card's back and forth as a chat, open until folded: the runs that asked and prepared it as thin lines, your
// answers on the right, the replies on the left, and Open run on every run behind them. Nothing until a message.
export function MessageHistory({
  item,
  entries,
  now
}: {
  item: InboxListRow
  entries: CardHistoryEntry[]
  now: number
}): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const messages = entries.filter((e) => e.kind === 'answer' || e.kind === 'reply').length
  if (messages === 0) {
    return null
  }
  const keys = contentKeys(entries, keyOf)
  return (
    <section
      aria-label="Message history"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-background/60"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="bg-muted/60 px-1">
          <CollapsibleTrigger variant="row">
            <span className="flex min-w-0 items-center gap-2 px-2">
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
              />
              <span className="text-[13px] font-bold">Message history</span>
              <span className="font-mono text-xs text-muted-foreground">
                {messages} {messages === 1 ? 'message' : 'messages'}
              </span>
            </span>
            <span className="px-2 text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-4 border-t border-border p-3">
            {entries.map((entry, i) => (
              <Line key={keys[i]} item={item} entry={entry} now={now} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function keyOf(entry: CardHistoryEntry): string {
  const words = entry.kind === 'answer' || entry.kind === 'reply' ? entry.text : ''
  return `${entry.kind}:${entry.at ?? '-'}:${entry.run?.id ?? ''}:${words}`
}

// React keys for a list without ids: each from its content, numbered where the same content repeats.
export function contentKeys<T>(items: readonly T[], keyOfItem: (item: T) => string): string[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const key = keyOfItem(item)
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return `${key}#${n}`
  })
}
