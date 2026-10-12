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

export function kindChipClass(_type: InboxItemRow['type'], small = false): string {
  return `${CHIP} ${small ? 'text-[11px]' : 'text-xs'} bg-muted text-muted-foreground`
}

export function statusPillClass(_status: StatusPill): string {
  return `${PILL} bg-muted text-muted-foreground`
}

export const JOB_CHIP_CLASS =
  'rounded px-1.5 text-[12.5px] font-semibold bg-muted text-foreground/80'
export const DRAFTED_PILL_CLASS = `${PILL} bg-muted text-muted-foreground`
