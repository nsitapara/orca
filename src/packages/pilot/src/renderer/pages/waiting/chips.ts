import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'

export type StatusPill =
  | 'waiting'
  | 'answered'
  | 'applying'
  | 'failed'
  | 'done'
  | 'unsaved'
  | 'Context queued'
  | 'Generating context'
  | 'Ready for decision'
  | 'Preparation blocked'

// Where a card stands, for its pill. A pick not yet saved is "unsaved". An answered card is "applying" only
// when the server says its answer is locked (it may be being carried out), "failed" when its row failed.
export function statusOf(
  item: Pick<InboxListRow, 'status' | 'preparation'>,
  answerState: AnswerState | null,
  unsaved: boolean
): StatusPill {
  if (unsaved) {
    return 'unsaved'
  }
  if (item.status === 'open') {
    switch (item.preparation?.state) {
      case 'queued':
        return 'Context queued'
      case 'generating':
        return 'Generating context'
      case 'ready':
        return 'Ready for decision'
      case 'blocked':
        return 'Preparation blocked'
      case 'cancelled':
      case undefined:
        return 'waiting'
    }
  }
  if (item.status === 'done') {
    return 'done'
  }
  if (answerState?.locked) {
    return 'applying'
  }
  return answerState?.state === 'failed' ? 'failed' : 'answered'
}

const PILL =
  'rounded-full px-2 font-mono text-xs font-semibold leading-[1.6] normal-case tracking-normal'
const WARN = 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'
const ACCENT = 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'

const PILL_COLOURS: Record<StatusPill, string> = {
  waiting: WARN,
  'Context queued': ACCENT,
  'Generating context': ACCENT,
  'Ready for decision': WARN,
  'Preparation blocked': WARN,
  answered: ACCENT,
  applying: `${ACCENT} animate-pulse`,
  failed: 'bg-[var(--ib-bad-soft)] text-[var(--ib-bad)]',
  done: 'bg-[var(--ib-ok-soft)] text-[var(--ib-ok)]',
  unsaved: 'bg-[var(--ib-accent)] text-[var(--ib-accent-fg)]'
}

export function statusPillClass(status: StatusPill): string {
  return `${PILL} ${PILL_COLOURS[status]}`
}

export const DRAFTED_PILL_CLASS = `${PILL} ${ACCENT}`
export const TICKETED_PILL_CLASS = `${PILL} ${ACCENT} shrink-0 underline-offset-2 hover:underline`
