import type { TicketDraft, TicketDraftEdit, TicketPriority } from '../../../shared/ticket-types'

export const TITLE_MAX = 255
const IMAGE_REF = /pilot-image:\d+/g

export const PRIORITY_WORDS: Record<TicketPriority, string> = {
  none: 'No priority',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

// The draft as the panel edits it: labels as typed, and the screenshots unticked.
export type DraftFields = {
  title: string
  body: string
  team: string
  state: string
  priority: TicketPriority
  labels: string
  unticked: string[]
}

// A frozen draft opens as it was filed, its screenshots ticked as they were.
export function fieldsOf(draft: TicketDraft): DraftFields {
  const refs = draft.images.map((image) => image.ref)
  const shown = draft.frozen ?? { ...draft, images: refs }
  return {
    title: shown.title,
    body: shown.body,
    team: shown.team,
    state: shown.state,
    priority: shown.priority,
    labels: shown.labels.join(', '),
    unticked: refs.filter((ref) => !shown.images.includes(ref))
  }
}

export function editOf(fields: DraftFields, draft: TicketDraft): TicketDraftEdit {
  return {
    title: fields.title.trim(),
    body: fields.body,
    team: fields.team.trim(),
    state: fields.state.trim(),
    priority: fields.priority,
    labels: fields.labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
    images: draft.images.map((i) => i.ref).filter((ref) => !fields.unticked.includes(ref))
  }
}

// What the server would refuse before anything is sent.
export function canCreate(edit: TicketDraftEdit): boolean {
  return (
    edit.title !== '' && edit.title.length <= TITLE_MAX && edit.team !== '' && edit.state !== ''
  )
}

function uploadsPart(edit: TicketDraftEdit): string | null {
  // Only a ticked screenshot the body still shows is uploaded.
  const shown = new Set(edit.body.match(IMAGE_REF))
  const count = edit.images.filter((ref) => shown.has(ref)).length
  if (count === 0) {
    return null
  }
  return count === 1 ? 'Uploads 1 screenshot' : `Uploads ${count} screenshots`
}

// "What Create does", from the fields as they stand.
export function createSummary(edit: TicketDraftEdit, link: boolean): string {
  const labels = edit.labels.length > 0 ? `, labelled ${edit.labels.join(', ')}` : ''
  const priority = PRIORITY_WORDS[edit.priority].toLowerCase()
  const parts = [
    uploadsPart(edit),
    `creates a ${edit.team} ticket in ${edit.state}, ${priority}${labels}, assigned to you`,
    link ? 'attaches the MR link' : null,
    'closes this card'
  ].filter((part) => part !== null)
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}
