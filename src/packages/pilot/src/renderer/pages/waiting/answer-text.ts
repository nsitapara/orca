import type { InboxListRow, InboxType } from '../../../shared/api-types'
import type { DispatchReport, QueueEntry } from '../../../shared/inbox-types'
import { startsRun } from '../../../shared/answers/route'

const ACTION_TYPES = new Set<InboxType>(['action', 'bug', 'left_for_you'])

const DEFAULT_ASK = [
  { label: 'Approve', meaning: 'start it now' },
  { label: 'Skip', meaning: 'nothing starts' }
]

export type Choice = {
  label: string
  meaning: string
  // 'optional': notes may follow but aren't needed (Approve with notes…, or a start option of a multi-start card).
  notes: 'none' | 'optional' | 'required'
  // The card's option this choice is, or null for one the page adds (Revise…, Keep, Something else…).
  option: number | null
  text(notes: string): string
}

function optionAt(item: InboxListRow, pattern: RegExp): number | null {
  const at = item.options.findIndex((o) => pattern.test(o.label))
  return at === -1 ? null : at
}

function meaningAt(item: InboxListRow, at: number | null): string {
  return at === null ? '' : item.options[at].meaning
}

// A card with more than one start option (Backend, Full stack + UI, Skip): each start option takes optional notes,
// saved as "approve: <notes>" with its own index, so the run gets both {run.choice} and {run.answer}.
function multiStartChoices(options: InboxListRow['options'], labels: string[]): Choice[] {
  return options.map((o, i) => {
    if (!startsRun(i, labels)) {
      return { label: o.label, meaning: o.meaning, notes: 'none', option: i, text: () => o.label }
    }
    return {
      label: o.label,
      meaning: o.meaning,
      notes: 'optional',
      option: i,
      text: (n: string) => (n.trim() ? `approve: ${n.trim()}` : o.label)
    }
  })
}

// An ask-first card (G4): its options are the choices, the first one starts the run. Approve with notes…
// starts it too, and the notes become the run's {run.answer} ("approve: <notes>", R-2).
function askFirstChoices(item: InboxListRow): Choice[] {
  const options = item.options.length > 0 ? item.options : DEFAULT_ASK
  const labels = options.map((o) => o.label)
  if (labels.filter((_, i) => startsRun(i, labels)).length > 1) {
    return multiStartChoices(options, labels)
  }
  const choices: Choice[] = options.map((o, i) => ({
    label: o.label,
    meaning: o.meaning,
    notes: 'none',
    option: i,
    text: () => o.label
  }))
  const withNotes: Choice = {
    label: 'Approve with notes…',
    meaning: 'start it, and tell the run something',
    notes: 'optional',
    option: null,
    text: (n) => (n.trim() ? `approve: ${n.trim()}` : 'approve')
  }
  return [choices[0], withNotes, ...choices.slice(1)]
}

function actionChoices(item: InboxListRow): Choice[] {
  if (item.action === 'start_run') {
    return askFirstChoices(item)
  }
  const approve = optionAt(item, /^approve$/i)
  const skip = optionAt(item, /^skip$/i)
  const choices: Choice[] = [
    {
      label: 'Approve',
      meaning: meaningAt(item, approve),
      notes: 'none',
      option: approve,
      text: () => 'approve'
    }
  ]
  if (item.action && item.action !== 'start_run') {
    choices.push({
      label: 'Revise…',
      meaning: 'change it and ask again; nothing runs',
      notes: 'required',
      option: null,
      text: (n) => `revise: ${n.trim()}`
    })
  }
  if (!item.action) {
    choices.push({
      label: 'Approve with notes…',
      meaning: 'say how it should be done',
      notes: 'required',
      option: null,
      text: (n) => n.trim()
    })
  }
  choices.push({
    label: 'Skip',
    meaning: meaningAt(item, skip),
    notes: 'none',
    option: skip,
    text: () => 'skip'
  })
  return choices
}

// An option ending in "…" (Change…) takes notes: "change: <notes>".
function optionChoice(label: string, meaning: string, index: number): Choice {
  if (!label.endsWith('…')) {
    return { label, meaning, notes: 'none', option: index, text: () => label }
  }
  const word = label.slice(0, -1).toLowerCase()
  return { label, meaning, notes: 'required', option: index, text: (n) => `${word}: ${n.trim()}` }
}

function questionChoices(item: InboxListRow): Choice[] {
  const choices = item.options.map((o, i) => optionChoice(o.label, o.meaning, i))
  const keeps = item.type === 'default' || item.type === 'flagged'
  if (keeps && !item.options.some((o) => /^keep$/i.test(o.label))) {
    choices.push({
      label: 'Keep',
      meaning: 'leave it as the agent decided',
      notes: 'none',
      option: null,
      text: () => 'keep'
    })
  }
  choices.push({
    label: 'Something else…',
    meaning: 'write your own answer',
    notes: 'required',
    option: null,
    text: (n) => n.trim()
  })
  return choices
}

export function choicesFor(item: InboxListRow): Choice[] {
  return ACTION_TYPES.has(item.type) ? actionChoices(item) : questionChoices(item)
}

// The text a saved answer carries (what apply.py's routing reads), or null while notes are missing.
export function composeAnswer(
  choice: Choice,
  notes: string
): { option: number | null; text: string } | null {
  if (choice.notes === 'required' && !notes.trim()) {
    return null
  }
  return { option: choice.option, text: choice.text(notes) }
}

// The one-line view of a Run line; past this it says how much more there is, and the card keeps it all.
export const RUN_LINE_MAX = 300

export function runLineView(text: string): { head: string; more: number } {
  if (text.length <= RUN_LINE_MAX) {
    return { head: text, more: 0 }
  }
  return { head: text.slice(0, RUN_LINE_MAX), more: text.length - RUN_LINE_MAX }
}

export const QUEUE_PILL = {
  not_ready: { label: 'Not ready', variant: 'outline' },
  ready: { label: 'Ready', variant: 'secondary' },
  held: { label: 'Held', variant: 'default' }
} as const

// "2:59": the time left, rounded up to the second, never below zero.
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function queueNote(
  entry: Pick<QueueEntry, 'state' | 'holdDetail' | 'readyAt'>,
  now: number
): string {
  if (entry.state === 'held' && entry.holdDetail) {
    return entry.holdDetail
  }
  if (entry.state === 'not_ready' && entry.readyAt > now) {
    return `Goes in ${countdown(entry.readyAt - now)}`
  }
  return 'Next answer check, under a minute'
}

// The console's "Held 20+ min": an answer held this long past its settle wants a look. A not-yet hold ('waits') moves
// its own recheck time on, so it never counts.
const HELD_TOO_LONG_MS = 20 * 60_000

export function heldTooLong(
  entry: Pick<QueueEntry, 'state' | 'holdReason' | 'readyAt'>,
  now: number
): boolean {
  return (
    entry.state === 'held' &&
    entry.holdReason !== 'waits' &&
    now - entry.readyAt >= HELD_TOO_LONG_MS
  )
}

// The folded In motion line's answers part: "3 from your answers (2 held · 1 in 2:41)".
export function queueSummary(
  entries: Pick<QueueEntry, 'state' | 'readyAt'>[],
  now: number
): string {
  const held = entries.filter((e) => e.state === 'held').length
  const settling = entries.filter((e) => e.state === 'not_ready' && e.readyAt > now)
  const due = entries.length - held - settling.length
  const parts: string[] = []
  if (held) {
    parts.push(`${held} held`)
  }
  if (due) {
    parts.push(`${due} at the next check`)
  }
  if (settling.length) {
    const first = countdown(Math.min(...settling.map((e) => e.readyAt)) - now)
    parts.push(`${settling.length} ${settling.length === 1 ? 'in' : 'from'} ${first}`)
  }
  return `${entries.length} from your answers (${parts.join(' · ')})`
}

// What one Apply now did, in a line: "2 closed · 3 still held", or that there was nothing to do.
export function applyReport(r: DispatchReport): string {
  const parts = [
    [r.ticked, 'closed'],
    [r.actions, 'ran an action'],
    [r.agents, 'sent to an agent'],
    [r.reasked, 'asked again'],
    [r.retired, 'retired with the MR'],
    [r.held, 'still held']
  ] as const
  const said = parts.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`)
  return said.length ? said.join(' · ') : 'Nothing was due'
}

export function worktreeName(path: string | null): string {
  if (!path) {
    return 'Job-wide'
  }
  return path.replace(/\/+$/, '').split('/').at(-1) || path
}

// Waiting on you: open cards that aren't defaults; a cancelled preparation still leaves one you can answer.
export function waitingCount(items: InboxListRow[]): number {
  return items.filter(
    (i) =>
      i.status === 'open' &&
      i.type !== 'default' &&
      (!i.preparation || i.preparation.state === 'ready' || i.preparation.state === 'cancelled')
  ).length
}

export function preparingCount(items: InboxListRow[]): number {
  return items.filter(
    (item) =>
      item.status === 'open' &&
      item.type !== 'default' &&
      (item.preparation?.state === 'queued' || item.preparation?.state === 'generating')
  ).length
}

export function preparationBlockedCount(items: InboxListRow[]): number {
  return items.filter(
    (item) =>
      item.status === 'open' && item.type !== 'default' && item.preparation?.state === 'blocked'
  ).length
}

const DAY_MS = 86_400_000

// How long a card has waited, short: "12m", "3h", "5d"; past a week, the date ("Sep 20"). One formatter for the
// list rows, the badges and the card's own "Asked" line.
export function ageLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  if (now - createdAt > 7 * DAY_MS) {
    return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${Math.floor(hours / 24)}d`
}

// ICU puts a narrow no-break space before AM/PM; plain spaces read (and test) the same everywhere.
function plain(text: string): string {
  return text.replace(/[\u202f\u00a0]/g, ' ')
}

// "Asked Oct 11, 2:00 AM · 1d ago" (no "ago" past a week, when the date says it), and the full timestamp.
export function askedLabel(
  createdAt: number,
  now: number
): { text: string; full: string; when: string; relative: string | null } {
  const sameYear = new Date(createdAt).getFullYear() === new Date(now).getFullYear()
  const when = plain(
    new Date(createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit'
    })
  )
  const recent = now - createdAt <= 7 * DAY_MS
  const relative = recent ? `${ageLabel(createdAt, now)} ago` : null
  const text = relative ? `Asked ${when} · ${relative}` : `Asked ${when}`
  const full = plain(
    new Date(createdAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  )
  return { text, full, when, relative }
}

// "04" from a job named "04 · Test branch UIs overnight"; the automation's id when its name has no code.
export function jobCode(name: string, id: string): string {
  return /^(\d+)\b/.exec(name)?.[1] ?? id
}
