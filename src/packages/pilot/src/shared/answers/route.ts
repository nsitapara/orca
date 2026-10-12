import type { InboxType } from '../api-types'

// apply.py:30-34. "ok" approves an action and keeps a default or flagged card; "no" skips an action but
// is just an answer to a question.
export const APPROVE: ReadonlySet<string> = new Set(['approve', 'yes', 'ok', 'do it'])
export const SKIP: ReadonlySet<string> = new Set(['skip', 'no', "don't", 'dont'])
export const KEEP: ReadonlySet<string> = new Set(['keep', 'ok'])
export const QUESTION_TYPES: ReadonlySet<InboxType> = new Set(['question', 'flagged', 'default'])
export const START_RUN_ONLY =
  'Answer Approve or Skip: this card only starts its run or leaves it unstarted.'

const LEAVE_OUT = /^(?:approve except|keep):\s*(.+)$/
const PART_NOTE = /(?:^|;)\s*(?:revise:\s*)?part\s+[\w.-]+\s*:/

export type RoutableAnswer = {
  type: InboxType
  action: string | null
  // The card's action is one Pilot's catalog can run (apply.py: it has a Run: line).
  runnable: boolean
  // { "<part id>": "<label>" }, in the card's order (ids that are plain integers sort numerically).
  parts: Record<string, string>
  text: string
  // The 0-based option the answer picked, when it picked one.
  option?: number | null
}

export type Route =
  | { kind: 'tick'; outcome: 'kept' | 'skipped' }
  | { kind: 'script'; leaveOut: string[] }
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

// apply.py resolve: each ref (a part id, an MR number or a branch word) must name exactly one part.
export function resolveParts(parts: Record<string, string>, refs: string): string[] | null {
  const entries = Object.entries(parts)
  const found: string[] = []
  for (const ref of refs
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)) {
    const wanted = ref.toLowerCase()
    const match = entries.filter(
      ([id, label]) =>
        id.toLowerCase() === wanted || label.toLowerCase().split(/\s+/).includes(wanted)
    )
    if (match.length !== 1) {
      return null
    }
    found.push(match[0][0])
  }
  return found
}

const START_NOTES = /^(?:approve|yes|ok|do it|start):\s*(\S.*)$/i

// The notes on an Approve of an ask-first card ("approve: use the second fix"): the run's {run.answer}.
export function startNotes(text: string): string {
  return START_NOTES.exec(text.trim())?.[1].trim() ?? ''
}

// An ask-first card takes Approve or Skip: by the option picked (the first starts the run), else by the words.
function routeStartRun(word: string, text: string, option: number | null | undefined): Route {
  if (option === 0 || APPROVE.has(word) || word === 'start' || startNotes(text) !== '') {
    return { kind: 'script', leaveOut: [] }
  }
  if ((option !== null && option !== undefined) || SKIP.has(word)) {
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
    return { kind: 'script', leaveOut: [] }
  }
  const leaveOut = LEAVE_OUT.exec(word)
  const partIds = Object.keys(answer.parts)
  if (partIds.length > 0 && leaveOut && !PART_NOTE.test(word)) {
    const ids = resolveParts(answer.parts, leaveOut[1])
    if (ids === null) {
      return { kind: 'agent', revise: true }
    }
    if (partIds.every((id) => ids.includes(id))) {
      return { kind: 'tick', outcome: 'skipped' }
    }
    return { kind: 'script', leaveOut: ids }
  }
  return { kind: 'agent', revise: true }
}

export function routeAnswer(answer: RoutableAnswer): Route {
  const word = answerWord(answer.text)
  if (answer.action === 'start_run') {
    return routeStartRun(word, answer.text, answer.option)
  }
  if (QUESTION_TYPES.has(answer.type)) {
    if ((answer.type === 'default' || answer.type === 'flagged') && KEEP.has(word)) {
      return { kind: 'tick', outcome: 'kept' }
    }
    return { kind: 'agent', revise: false }
  }
  return routeAction(answer, word)
}
