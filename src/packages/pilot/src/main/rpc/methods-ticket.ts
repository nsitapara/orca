import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { TICKET_PRIORITIES } from '../../shared/ticket-types'
import { buildTicketDraft } from '../inbox/ticket-draft'
import { fileTicketForLater, type TicketForLaterDeps } from '../inbox/ticket-for-later'
import type { PilotContext } from '../pilot-services'
import { skillSearchDirs } from '../run/modes'
import { attemptDeps } from './methods-actions'
import { inboxDeps } from './methods-inbox'
import { byPerson } from './methods-preparation'

export const DRAFT_BY_PERSON = "Draft the ticket from Pilot's window or a paired device"
export const CREATE_ON_DESKTOP = "Create the ticket from Pilot's desktop app"

const Card = z.object({ id: z.string().min(1), digest: z.string().min(1) })
const Create = Card.extend({
  draft: z.object({
    title: z.string().min(1).max(255),
    body: z.string(),
    team: z.string().min(1),
    state: z.string().min(1),
    priority: z.enum(TICKET_PRIORITIES),
    labels: z.array(z.string().min(1)),
    images: z.array(z.string())
  })
})

function ticketDeps(c: PilotContext): TicketForLaterDeps {
  return {
    store: c.store,
    definitions: () => c.loaded().definitions,
    detailsRoot: c.detailsRoot ?? null,
    skillDirs: () => skillSearchDirs(null),
    attempt: attemptDeps(c),
    inbox: inboxDeps(c)
  }
}

export function buildTicketMethods(ctx: () => PilotContext) {
  return [
    // A card's follow-up ticket draft; it writes nothing. The desktop or a paired device, never the local CLI.
    defineMethod({
      name: 'pilot.inbox.ticketDraft',
      permission: 'workspace',
      params: Card,
      handler: (p, rpc) => {
        if (!byPerson(rpc.caller)) {
          throw new Error(DRAFT_BY_PERSON)
        }
        return buildTicketDraft(ticketDeps(ctx()), p.id, p.digest)
      }
    }),
    // Create posts to Linear, so like Approve it is desktop-only.
    defineMethod({
      name: 'pilot.inbox.ticketForLater',
      permission: 'workspace',
      params: Create,
      handler: (p, rpc) => {
        if (rpc.caller?.kind !== 'desktop') {
          throw new Error(CREATE_ON_DESKTOP)
        }
        return fileTicketForLater(ticketDeps(ctx()), p)
      }
    })
  ]
}
