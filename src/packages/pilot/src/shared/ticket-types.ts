export const TICKET_PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export type TicketedRef = { identifier: string; url: string }

// ref is 'pilot-image:N'; file is bundle-relative.
export type TicketImage = { ref: string; file: string; caption: string }

export type TicketDraft = {
  title: string
  body: string
  team: string
  state: string
  priority: TicketPriority
  labels: string[]
  assignee: 'me'
  images: TicketImage[]
  link: { url: string; title: string } | null
  ticketedBefore: TicketedRef | null
  templatePath: string
  digest: string
}

export type TicketDraftEdit = {
  title: string
  body: string
  team: string
  state: string
  priority: TicketPriority
  labels: string[]
  // Refs of the images to include.
  images: string[]
}

export type TicketCreateResult =
  | { ok: true; identifier: string; url: string }
  | { ok: false; error: string; maybeCreated: boolean }
