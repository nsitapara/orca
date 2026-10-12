import type { InboxItemRow, InboxType } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'

export const KIND_LABEL: Record<InboxType, string> = {
  question: 'Question',
  flagged: 'Flagged',
  default: 'Default taken',
  action: 'Action',
  bug: 'Bug',
  left_for_you: 'Left for you'
}
const ACTION_TYPES = new Set<InboxType>(['action', 'bug', 'left_for_you'])

export type Choice = {
  label: string
  meaning: string
  notes: 'none' | 'required'
  // The card's option this choice is, or null for one the page adds (Revise…, Keep, Something else…).
  option: number | null
  text(notes: string): string
}

function optionAt(item: InboxItemRow, pattern: RegExp): number | null {
  const at = item.options.findIndex((o) => pattern.test(o.label))
  return at === -1 ? null : at
}

function meaningAt(item: InboxItemRow, at: number | null): string {
  return at === null ? '' : item.options[at].meaning
}

function actionChoices(item: InboxItemRow): Choice[] {
  // An ask-first card with its own options (G4): they are the choices, the first one starts the run.
  if (item.action === 'start_run' && item.options.length > 0) {
    return item.options.map((o, i) => ({
      label: o.label,
      meaning: o.meaning,
      notes: 'none',
      option: i,
      text: () => o.label
    }))
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

function questionChoices(item: InboxItemRow): Choice[] {
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

export function choicesFor(item: InboxItemRow): Choice[] {
  return ACTION_TYPES.has(item.type) ? actionChoices(item) : questionChoices(item)
}

// The text a saved answer carries (what apply.py's routing reads), or null while notes are missing.
export function composeAnswer(
  item: InboxItemRow,
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
export function waitingCount(items: InboxItemRow[]): number {
  return items.filter((i) => i.status === 'open' && i.type !== 'default').length
}
