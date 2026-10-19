import type { InboxListRow } from '../../../shared/api-types'
import { ticketRefusal } from '../../../shared/ticket-outcome'
import type { PilotHostRef } from '../../hosts/pilot-host'
import { heldForEvidence } from './answer-buttons'

// Only this Pilot's own cards, in the desktop app: Create is desktop-only, like Approve.
export function canTicketForLater(item: InboxListRow, host: PilotHostRef, web: boolean): boolean {
  return !ticketRefusal(item) && !heldForEvidence(item) && host.local && !web
}
