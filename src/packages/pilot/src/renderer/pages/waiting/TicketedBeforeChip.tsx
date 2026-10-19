import { safeHref } from '../../../shared/safe-href'
import type { TicketedRef } from '../../../shared/ticket-types'
import { TICKETED_PILL_CLASS } from './chips'

// The ticket an earlier card about this finding was filed as. It only informs: the card stays.
export function TicketedBeforeChip({ ticket }: { ticket: TicketedRef }): React.JSX.Element {
  const text = `Ticketed before · ${ticket.identifier}`
  const href = safeHref(ticket.url)
  if (!href) {
    return <span className={TICKETED_PILL_CLASS}>{text}</span>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={TICKETED_PILL_CLASS}>
      {text}
    </a>
  )
}
