import type { InboxItemRow } from '../../shared/api-types'
import { formatTicketedOutcome } from '../../shared/ticket-outcome'
import type {
  TicketCreateResult,
  TicketDraft,
  TicketDraftEdit,
  TicketImage
} from '../../shared/ticket-types'
import { attemptAction, recordPilotAsk, type AttemptDeps } from '../actions/attempt'
import { messageOf } from '../actions/linear-create-outcome'
import { writeIdFor } from '../actions/linear-entries'
import { actionFailed } from '../actions/types'
import { outcomeText } from '../answers/apply-script'
import { MAX_ACTION_ARGS_BYTES } from './card'
import { readDetailsImageBytes } from './details-bundle'
import { sha256 } from './details-read'
import { addInboxItem } from './inbox-add'
import { resolveInboxItem, type InboxDeps } from './inbox-service'
import { buildTicketDraft, type TicketDraftDeps } from './ticket-draft'

export type TicketForLaterDeps = TicketDraftDeps & { attempt: AttemptDeps; inbox: InboxDeps }
export type TicketForLaterRequest = { id: string; digest: string; draft: TicketDraftEdit }

export const ALREADY_FILING = 'This card is already being filed'
export const TOO_LONG_TO_FILE = 'The description is too long to file; shorten it.'
const TICKET_OPTIONS = ['Approve — create it', 'Skip — leave it']
const IMAGE_REF = /pilot-image:\d+/g

type TicketArgs = Record<string, unknown> & { title: string; team: string }
type Filed = { id: string; digest: string } | { error: string }

// Cards whose Create is running in this process: a second click is refused, never a second ticket card.
const filing = new Set<string>()

const notFiled = (error: string): TicketCreateResult => ({ ok: false, error, maybeCreated: false })

// Every attempt for one card shares one Linear write id, so a retry can never make a second ticket.
const ticketWriteId = (cardId: string): string => writeIdFor(`ticket-for-later\0${cardId}`)

// The body without any line naming a screenshot that won't post: one unticked, or a ref with no image.
function keptBody(body: string, kept: ReadonlySet<string>): string {
  return body
    .split('\n')
    .filter((line) => (line.match(IMAGE_REF) ?? []).every((ref) => kept.has(ref)))
    .join('\n')
}

// Each kept screenshot the body still shows, resolved inside the Automations folder and hashed now.
function imageArgs(deps: TicketForLaterDeps, id: string, kept: TicketImage[], body: string) {
  const shown = new Set(body.match(IMAGE_REF))
  const snapshot = deps.store.inbox.currentDetails(id)?.snapshot
  if (!snapshot) {
    return []
  }
  return kept
    .filter((image) => shown.has(image.ref))
    .map((image) => {
      const { path, bytes } = readDetailsImageBytes(deps.detailsRoot, snapshot, image.file)
      return { ref: image.ref, path, sha256: sha256(bytes), caption: image.caption }
    })
}

// linear_create's args, built here from the rebuilt draft and the person's edits; the link and assignee
// never come from the client.
function argsFor(deps: TicketForLaterDeps, req: TicketForLaterRequest, draft: TicketDraft) {
  const edit = req.draft
  const kept = draft.images.filter((image) => edit.images.includes(image.ref))
  const body = keptBody(edit.body, new Set(kept.map((image) => image.ref)))
  const args: TicketArgs = {
    title: edit.title,
    body,
    team: edit.team,
    state: edit.state,
    priority: edit.priority,
    labels: edit.labels,
    assignee: 'me',
    images: imageArgs(deps, req.id, kept, body),
    links: draft.link ? [{ url: draft.link.url, title: draft.link.title }] : [],
    write_id: ticketWriteId(req.id)
  }
  // card.ts's check, so the card add can't refuse it with a vaguer message.
  if (JSON.stringify(args).length >= MAX_ACTION_ARGS_BYTES) {
    throw new Error(TOO_LONG_TO_FILE)
  }
  return args
}

// The card as it is now, open, unchanged since the draft, and fileable; and the args to file for it.
function ticketToFile(
  deps: TicketForLaterDeps,
  req: TicketForLaterRequest
): { card: InboxItemRow; args: TicketArgs } {
  const draft = buildTicketDraft(deps, req.id, req.digest)
  const card = deps.store.inbox.get(req.id)
  if (card?.status !== 'open') {
    throw new Error(`This card is already ${card?.status ?? 'gone'}`)
  }
  return { card, args: argsFor(deps, req, draft) }
}

// A card closed meanwhile stays as it is; the ticket's fate is already settled.
function close(deps: TicketForLaterDeps, id: string, outcome: string): void {
  try {
    resolveInboxItem(deps.inbox, id, outcome)
  } catch (error) {
    console.error(`pilot: couldn't close card ${id} (${outcome}): ${messageOf(error)}`)
  }
}

// Pilot files its own linear_create card and asks about it, as ask_first's recordAsked does, but outside any
// run, so no run's status moves. A card whose ask isn't recorded could never be approved, so it is closed.
function fileTicketCard(deps: TicketForLaterDeps, card: InboxItemRow, args: TicketArgs): Filed {
  let id: string
  try {
    const added = addInboxItem(deps.inbox, {
      automationId: card.automationId,
      itemKey: card.itemKey ?? undefined,
      type: 'action',
      title: `Create a ${args.team} ticket: ${args.title}?`,
      context: `Ticket for later from card ${card.id}.`,
      options: TICKET_OPTIONS,
      action: 'linear_create',
      actionArgs: args
    })
    if (!added.id) {
      return { error: added.refused ?? 'the ticket card was refused' }
    }
    id = added.id
  } catch (error) {
    return { error: messageOf(error) }
  }
  try {
    const row = { action: 'linear_create', runId: null, inboxItemId: id }
    recordPilotAsk(deps.attempt, row, args, `Asked to ticket card ${card.id} for later`)
  } catch (error) {
    close(deps, id, `obsolete: not created: ${messageOf(error)}`)
    return { error: messageOf(error) }
  }
  return { id, digest: deps.store.inbox.get(id)?.digest ?? '' }
}

async function fileOnce(
  deps: TicketForLaterDeps,
  req: TicketForLaterRequest
): Promise<TicketCreateResult> {
  let ticket: { card: InboxItemRow; args: TicketArgs }
  try {
    ticket = ticketToFile(deps, req)
  } catch (error) {
    return notFiled(messageOf(error))
  }
  const filed = fileTicketCard(deps, ticket.card, ticket.args)
  if ('error' in filed) {
    return notFiled(filed.error)
  }
  // The person reviewed the draft and pressed Create: the card is approved, with no settle window.
  const attempted = await attemptAction(deps.attempt, {
    action: 'linear_create',
    approved: true,
    inboxItemId: filed.id,
    runId: null,
    digest: filed.digest,
    dryRun: false
  })
  const result = attempted.outcome === 'asked' ? actionFailed(attempted.detail) : attempted
  if (result.outcome !== 'done') {
    close(deps, filed.id, `obsolete: not created: ${result.detail}`)
    return { ok: false, error: result.detail, maybeCreated: result.data?.created === 'maybe' }
  }
  const ref = { identifier: result.data?.identifier ?? '', url: result.data?.url ?? '' }
  close(deps, filed.id, outcomeText(result))
  close(deps, req.id, formatTicketedOutcome(ref))
  return { ok: true, ...ref }
}

// Create: files the reviewed draft as a Linear ticket through Pilot's own linear_create card and
// attemptAction, then closes that card and the original. A failure leaves the original open.
export async function fileTicketForLater(
  deps: TicketForLaterDeps,
  req: TicketForLaterRequest
): Promise<TicketCreateResult> {
  if (filing.has(req.id)) {
    return notFiled(ALREADY_FILING)
  }
  filing.add(req.id)
  try {
    return await fileOnce(deps, req)
  } finally {
    filing.delete(req.id)
  }
}
