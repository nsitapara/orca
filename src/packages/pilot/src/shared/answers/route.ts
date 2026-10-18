import type { InboxType } from '../api-types'

// apply.py:30-34. "ok" approves an action and keeps a default or flagged card; "no" skips an action but
// is just an answer to a question.
export const APPROVE: ReadonlySet<string> = new Set(['approve', 'yes', 'ok', 'do it'])
export const SKIP: ReadonlySet<string> = new Set(['skip', 'no', "don't", 'dont'])
export const KEEP: ReadonlySet<string> = new Set(['keep', 'ok'])
export const QUESTION_TYPES: ReadonlySet<InboxType> = new Set(['question', 'flagged', 'default'])
export const START_RUN_ONLY =
  'Answer Approve or Skip: this card only starts its run or leaves it unstarted.'

export type RoutableAnswer = {
  type: InboxType
  action: string | null
  // The card's action is one Pilot's catalog can run (apply.py: it has a Run: line).
  runnable: boolean
  text: string
  // The 0-based option the answer picked, when it picked one.
  option?: number | null
  // The card's option labels, in order. Without them only an ask-first card's first option starts its run.
  options?: readonly string[]
}

export type Route =
  | { kind: 'tick'; outcome: 'kept' | 'skipped' }
  | { kind: 'script' }
  | { kind: 'agent'; revise: boolean }
  | { kind: 'reask'; reason: string }

// apply.py _word: whitespace collapsed, lower case, trailing . and ! dropped.
export function answerWord(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[.!]+$/, '')
}

const START_NOTES = /^(?:approve|yes|ok|do it|start):\s*(\S.*)$/i

// The notes on an Approve of an ask-first card ("approve: use the second fix"): the run's {run.answer}.
export function startNotes(text: string): string {
  return START_NOTES.exec(text.trim())?.[1].trim() ?? ''
}

// Whether an ask-first card's option starts its run: any but a Skip one ("Skip", "No", …).
export function startsRun(option: number, labels: readonly string[] | undefined): boolean {
  if (labels === undefined) {
    return option === 0
  }
  const label = labels[option]
  return label !== undefined && !SKIP.has(answerWord(label))
}

// An ask-first card takes a start option or Skip: by the option picked, else by the words (which start the first).
function routeStartRun(
  word: string,
  text: string,
  option: number | null | undefined,
  labels: readonly string[] | undefined
): Route {
  const picked = option !== null && option !== undefined
  if (
    (picked && startsRun(option, labels)) ||
    APPROVE.has(word) ||
    word === 'start' ||
    startNotes(text) !== ''
  ) {
    return { kind: 'script' }
  }
  if (picked || SKIP.has(word)) {
    return { kind: 'tick', outcome: 'skipped' }
  }
  return { kind: 'reask', reason: START_RUN_ONLY }
}

function routeAction(answer: RoutableAnswer, word: string): Route {
  if (SKIP.has(word)) {
    return { kind: 'tick', outcome: 'skipped' }
  }
  if (!answer.runnable) {
    return { kind: 'agent', revise: false }
  }
  if (APPROVE.has(word)) {
    return { kind: 'script' }
  }
  return { kind: 'agent', revise: true }
}

export function routeAnswer(answer: RoutableAnswer): Route {
  const word = answerWord(answer.text)
  if (answer.action === 'start_run') {
    return routeStartRun(word, answer.text, answer.option, answer.options)
  }
  if (QUESTION_TYPES.has(answer.type)) {
    if ((answer.type === 'default' || answer.type === 'flagged') && KEEP.has(word)) {
      return { kind: 'tick', outcome: 'kept' }
    }
    return { kind: 'agent', revise: false }
  }
  return routeAction(answer, word)
}
