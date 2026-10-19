import { z } from 'zod'
import { TICKET_PRIORITIES, type TicketDraftEdit } from '../../shared/ticket-types'
import { writeIdFor } from '../actions/linear-entries'
import type { PilotStore } from '../store/store'

// How a Create's ticket card closes when it failed: Linear may hold the ticket, or it surely doesn't.
export const MAY_HAVE_CREATED = 'obsolete: may have created: '
export const NOT_CREATED = 'obsolete: not created: '

// Every attempt for one card shares one Linear write id, so a retry can never make a second ticket.
export const ticketWriteId = (cardId: string): string => writeIdFor(`ticket-for-later\0${cardId}`)

const FiledArgs = z.object({
  title: z.string(),
  body: z.string(),
  team: z.string(),
  state: z.string(),
  priority: z.enum(TICKET_PRIORITIES),
  labels: z.array(z.string()),
  images: z.array(z.object({ ref: z.string() }))
})

// The draft fields a ticket card's linear_create args carry, as Create would send them; null: not Pilot's args.
export function filedDraft(args: unknown): TicketDraftEdit | null {
  const parsed = FiledArgs.safeParse(args)
  if (!parsed.success) {
    return null
  }
  const a = parsed.data
  return {
    title: a.title,
    body: a.body,
    team: a.team,
    state: a.state,
    priority: a.priority,
    labels: a.labels,
    images: a.images.map((image) => image.ref)
  }
}

// The draft a Create that may have reached Linear filed for this card; Linear may hold that ticket.
export function frozenDraftFor(store: PilotStore, cardId: string): TicketDraftEdit | null {
  const args = store.inbox.closedWriteArgs('linear_create', MAY_HAVE_CREATED, ticketWriteId(cardId))
  return args === null ? null : filedDraft(args)
}

// Both built by filedDraft, so their keys come in one order.
export function sameDraft(a: TicketDraftEdit | null, b: TicketDraftEdit): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}
