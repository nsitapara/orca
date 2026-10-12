import type { InboxItemRow } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'
import { phaseOf } from './answer-buttons'

export type StatusPill = 'waiting' | 'answered' | 'applying' | 'done' | 'unsaved'

// Where a card stands, for its pill. A pick not yet saved is "unsaved". An answered card is "applying" once
// its settle time has passed (a ready row) or its row is gone (dispatched); until then it is "answered".
export function statusOf(
  item: Pick<InboxItemRow, 'status'>,
  queued: Pick<QueueEntry, 'state' | 'readyAt'> | null,
  unsaved: boolean,
  now: number
): StatusPill {
  if (unsaved) {
    return 'unsaved'
  }
  if (item.status === 'open') {
    return 'waiting'
  }
  if (item.status === 'done') {
    return 'done'
  }
  return phaseOf(queued, now) === 'applying' ? 'applying' : 'answered'
}

const PILL = 'rounded-full px-2 font-mono text-xs font-semibold leading-[1.6]'
const WARN = 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'
const ACCENT = 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'

const PILL_COLOURS: Record<StatusPill, string> = {
  waiting: WARN,
  answered: ACCENT,
  applying: `${ACCENT} animate-pulse`,
  done: 'bg-[var(--ib-ok-soft)] text-[var(--ib-ok)]',
  unsaved: 'bg-[var(--ib-accent)] text-[var(--ib-accent-fg)]'
}

export function statusPillClass(status: StatusPill): string {
  return `${PILL} ${PILL_COLOURS[status]}`
}

export const JOB_CHIP_CLASS =
  'rounded bg-muted px-1.5 font-mono text-[12.5px] font-semibold text-foreground/80'
export const DRAFTED_PILL_CLASS = `${PILL} ${ACCENT}`
