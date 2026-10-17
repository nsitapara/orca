import type { InboxListRow, InboxType } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'
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
  item: InboxListRow,
  choice: Choice,
  notes: string,
  partsOff: string[]
): { option: number | null; text: string } | null {
  if (choice.notes === 'required' && !notes.trim()) {
    return null
  }
  const partCount = Object.keys(item.parts).length
  if (choice.label === 'Approve' && partCount > 0 && partsOff.length > 0) {
    if (partsOff.length === partCount) {
      return { option: null, text: 'skip' }
    }
    const keep = (item.switchWords[1] ?? '').toLowerCase() === 'keep'
    return { option: null, text: `${keep ? 'keep' : 'approve except'}: ${partsOff.join(', ')}` }
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

export function queueNote(
  entry: Pick<QueueEntry, 'state' | 'holdDetail' | 'readyAt'>,
  clock: (ms: number) => string
): string {
  if (entry.state === 'held' && entry.holdDetail) {
    return entry.holdDetail
  }
  if (entry.state === 'not_ready') {
    return `Settles at ${clock(entry.readyAt)}`
  }
  return 'Next answer check, under a minute'
}

export function worktreeName(path: string | null): string {
  if (!path) {
    return 'Job-wide'
  }
  return path.replace(/\/+$/, '').split('/').at(-1) || path
}

// What counts as waiting on you: open cards, never the defaults the agents took.
export function waitingCount(items: InboxListRow[]): number {
  return items.filter(
    (i) =>
      i.status === 'open' &&
      i.type !== 'default' &&
      (!i.preparation || i.preparation.state === 'ready')
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
