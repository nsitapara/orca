import type { InboxItemRow } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'

export type StatusPill = 'waiting' | 'answered' | 'applying' | 'done' | 'unsaved'

// Where a card stands, for its pill. A pick not yet saved is "unsaved".
export function statusOf(
  item: Pick<InboxItemRow, 'status'>,
  queued: Pick<QueueEntry, 'state'> | null,
  unsaved: boolean
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
  return queued?.state === 'dispatched' ? 'applying' : 'answered'
}

const CHIP = 'rounded px-1.5 font-mono font-semibold leading-[1.6]'
const PILL = 'rounded-full px-2 font-mono text-xs font-semibold leading-[1.6]'
const WARN = 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'
const BAD = 'bg-[var(--ib-bad-soft)] text-[var(--ib-bad)]'
const ACCENT = 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
const NEUTRAL = 'bg-muted text-foreground/80'

// The console's KIND chips: bug is bad, the kinds that ask are warn, the rest neutral.
function kindColours(type: InboxItemRow['type']): string {
  if (type === 'bug') {
    return BAD
  }
  if (type === 'question' || type === 'action' || type === 'flagged') {
    return WARN
  }
  return NEUTRAL
}

export function kindChipClass(type: InboxItemRow['type'], small = false): string {
  return `${CHIP} ${small ? 'text-[11px]' : 'text-xs'} ${kindColours(type)}`
}

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
