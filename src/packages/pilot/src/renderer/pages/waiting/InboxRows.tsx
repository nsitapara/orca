import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { InboxListRow, InboxType } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { phaseOf, quickAnswerFor, undoLabel } from './answer-buttons'
import { ageLabel, jobCode } from './answer-text'
import type { Answer } from './answer-types'
import { statusOf, type StatusPill } from './chips'

const KIND_LABEL: Record<InboxType, string> = {
  question: 'Question',
  action: 'Approval',
  bug: 'Bug',
  flagged: 'Flagged',
  left_for_you: 'Left for you',
  default: 'Default'
}

const DOT_COLOUR: Record<StatusPill, string> = {
  waiting: 'bg-[var(--ib-warn)]',
  'Context queued': 'bg-[var(--ib-accent)]',
  'Generating context': 'bg-[var(--ib-accent)] animate-pulse',
  'Ready for decision': 'bg-[var(--ib-warn)]',
  'Preparation blocked': 'bg-[var(--ib-warn)]',
  answered: 'bg-[var(--ib-accent)]',
  applying: 'bg-[var(--ib-accent)] animate-pulse',
  failed: 'bg-[var(--ib-bad)]',
  done: 'bg-[var(--ib-ok)]',
  unsaved: 'bg-[var(--ib-accent)]'
}

// Group by Nothing makes one section with no label: its region still needs a name.
const UNGROUPED_NAME = 'Rows'

function InboxRow({
  item,
  names,
  answerState,
  error,
  now,
  onAnswer,
  onOpen
}: {
  item: Hosted<InboxListRow>
  names: ReadonlyMap<string, string>
  answerState: AnswerState | null
  error: string | null
  now: number
  onAnswer: (item: Hosted<InboxListRow>, answer: Answer) => Promise<string | null>
  onOpen: (item: Hosted<InboxListRow>) => void
}): React.JSX.Element {
  // Disabled from the click until the save settles, so a second click can't send it again.
  const [saving, setSaving] = useState(false)
  const status = statusOf(item, answerState, false)
  const quick = quickAnswerFor(item)
  // The card's own Undo (or Change answer), until the server locks the answer.
  const undo =
    item.status === 'open' || answerState === null ? null : undoLabel(phaseOf(answerState, now))
  const send = async (answer: Answer) => {
    setSaving(true)
    await onAnswer(item, answer)
    setSaving(false)
  }
  const job = jobCode(names.get(item.automationId) ?? item.automationId, item.automationId)
  return (
    <li
      data-row={hostedKey(item.host, item.id)}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 hover:bg-accent"
    >
      <span
        role="img"
        aria-label={status}
        title={status}
        className={cn('size-2 shrink-0 rounded-full', DOT_COLOUR[status])}
      />
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[item.type]}</span>
      <span title={item.title} className="min-w-0 flex-1 truncate text-[13px] font-semibold">
        {item.title}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {job} · {ageLabel(item.createdAt, now)}
      </span>
      {quick ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void send(quick.answer)}
          className="shrink-0 rounded-md bg-[var(--ib-accent)] px-3 py-0.5 text-[13px] font-semibold text-[var(--ib-accent-fg)] disabled:opacity-50"
        >
          {quick.label}
        </button>
      ) : null}
      {undo ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void send({ option: null, text: '' })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[13px] font-semibold text-[var(--ib-accent)] hover:underline disabled:opacity-50"
        >
          {undo}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="shrink-0 rounded-md border border-border bg-background px-3 py-0.5 text-[13px] text-foreground hover:bg-muted"
      >
        Open
      </button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </li>
  )
}

// The dense view: one line per card in the same sections, so a one-click card is answered without opening it.
export function InboxRows({
  sections,
  answerStates,
  names,
  errors,
  now,
  onAnswer,
  onOpen
}: {
  sections: HostedSection[]
  // By hostedKey.
  answerStates: ReadonlyMap<string, AnswerState>
  names: ReadonlyMap<string, string>
  // A failed save's message, by hostedKey.
  errors: Readonly<Record<string, string>>
  now: number
  // Resolves to the save's error, or null once saved.
  onAnswer: (item: Hosted<InboxListRow>, answer: Answer) => Promise<string | null>
  onOpen: (item: Hosted<InboxListRow>) => void
}): React.JSX.Element {
  return (
    <>
      {sections.map((s) => (
        <section
          key={s.key}
          aria-label={s.group.label || UNGROUPED_NAME}
          className="flex min-w-0 flex-col gap-1"
        >
          {s.group.label ? (
            <h2
              title={s.group.label}
              className="truncate border-b border-border px-2.5 py-1 font-mono text-xs font-semibold text-muted-foreground"
            >
              {s.group.label} · {s.items.length}
            </h2>
          ) : null}
          <ul className="flex flex-col">
            {s.items.map((i) => (
              <InboxRow
                key={hostedKey(i.host, i.id)}
                item={i}
                names={names}
                answerState={answerStates.get(hostedKey(i.host, i.id)) ?? null}
                error={errors[hostedKey(i.host, i.id)] ?? null}
                now={now}
                onAnswer={onAnswer}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
