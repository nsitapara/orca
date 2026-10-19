import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InboxItemRow, ItemFields } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { imageRefs, type DetailsBundle } from '../../shared/details'
import { renderTemplate } from '../../shared/template'
import { findingTitle, ticketRefusal } from '../../shared/ticket-outcome'
import type { TicketDraft, TicketImage } from '../../shared/ticket-types'
import type { PilotStore } from '../store/store'
import { isInside } from './details-bundle'
import { branchOfRun, fieldsForRun, latestFieldsFor } from './run-fields'
import { loadTicketTemplate, renderTicketBody } from './ticket-template'
import { frozenDraftFor } from './ticket-freeze'
import { ticketedBeforeFor } from './ticketed-before'

export const CARD_CHANGED_ON_DRAFT = 'The card changed; reopen the draft'

export type TicketDraftDeps = {
  store: PilotStore
  definitions(): AutomationDefinition[]
  detailsRoot: string | null
  skillDirs(): string[]
}

const FOUND = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})
// A markdown link to a file:// URL, an autolinked one, or a bare one.
const FILE_LINK =
  /\[([^\]\n]*)\]\((file:\/\/[^\s)]+)\)|<(file:\/\/[^\s>]+)>|file:\/\/[^\s<>()[\]`'"]+/g
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

function stringField(fields: ItemFields, name: string): string | null {
  const value = fields[name]
  return typeof value === 'string' && value !== '' ? value : null
}

// A file:// link's path as a code span, from the Automations folder's own name when it's under it.
function pathSpan(link: string, root: string | null): string {
  let url: URL
  let path: string
  try {
    url = new URL(link)
    path = fileURLToPath(url)
  } catch {
    return `\`${link}\``
  }
  const shown =
    root !== null && isInside(root, path) ? join(basename(root), relative(root, path)) : path
  return `\`${shown}${url.hash}\``
}

// Linear can't open file:// links, so each becomes the path it names.
export function withVaultPaths(text: string, root: string | null): string {
  return text.replace(
    FILE_LINK,
    (whole, label: string | undefined, linked: string | undefined, angled: string | undefined) => {
      if (linked !== undefined) {
        const span = pathSpan(linked, root)
        return label ? `${label} (${span})` : span
      }
      if (angled !== undefined) {
        return pathSpan(angled, root)
      }
      const tail = TRAILING_PUNCTUATION.exec(whole)?.[0] ?? ''
      return pathSpan(whole.slice(0, whole.length - tail.length), root) + tail
    }
  )
}

// Every image a card's Details name, once, in bundle order; a screens pair gives a before and an after.
export function ticketImages(bundle: DetailsBundle): TicketImage[] {
  const captions = new Map<string, string>()
  const caption = (
    file: string | null | undefined,
    text: string | null | undefined,
    suffix = ''
  ) => {
    if (file && !captions.has(file)) {
      captions.set(file, `${text?.trim() || basename(file)}${suffix}`)
    }
  }
  for (const block of bundle.blocks) {
    if (block.type === 'screens') {
      for (const pair of block.pairs) {
        caption(pair.before, pair.caption, ' (before)')
        caption(pair.after, pair.caption, ' (after)')
      }
    } else if (block.type === 'shots') {
      for (const shot of block.shots) {
        caption(shot.file, shot.caption)
      }
    }
  }
  return [...new Set(imageRefs(bundle))].map((file, i) => ({
    ref: `pilot-image:${i + 1}`,
    file,
    caption: captions.get(file) ?? basename(file)
  }))
}

function imageLine(image: TicketImage): string {
  const alt = image.caption.replace(/\s+/g, ' ').replace(/[[\]\\]/g, '\\$&')
  return `![${alt}](${image.ref})`
}

// The fields the card's job saw: its run's, else the item's latest tick's.
function runFieldsOf(store: PilotStore, card: InboxItemRow): ItemFields {
  if (card.runId) {
    return fieldsForRun(store, card.runId)
  }
  return card.itemKey === null ? {} : latestFieldsFor(store, card.automationId, card.itemKey)
}

function ticketFields(
  deps: TicketDraftDeps,
  card: InboxItemRow,
  run: ItemFields,
  images: TicketImage[]
): ItemFields {
  const { title, location } = findingTitle(card.title)
  const definition = deps.definitions().find((d) => d.id === card.automationId)
  const branch = card.runId ? branchOfRun(deps.store, card.runId) : null
  return {
    ...run,
    title,
    context: withVaultPaths(card.context, deps.detailsRoot),
    suggested: card.suggested === null ? null : withVaultPaths(card.suggested, deps.detailsRoot),
    location,
    job: definition?.name ?? card.automationId,
    found: FOUND.format(card.createdAt),
    branch: branch ?? stringField(run, 'worktree.branch'),
    screenshots: images.map(imageLine).join('\n'),
    automation_id: card.automationId,
    item_key: card.itemKey,
    card_id: card.id
  }
}

function mrLink(run: ItemFields): TicketDraft['link'] {
  const url = stringField(run, 'mr.web_url')
  if (url === null || !/^https?:\/\//i.test(url)) {
    return null
  }
  return { url, title: stringField(run, 'mr.title') ?? 'Merge request' }
}

// The editable draft of a card's follow-up ticket, built now from the stored card; it writes nothing.
export function buildTicketDraft(deps: TicketDraftDeps, id: string, digest: string): TicketDraft {
  const card = deps.store.inbox.get(id)
  if (!card) {
    throw new Error(`No inbox item ${id}`)
  }
  if (card.digest !== digest) {
    throw new Error(CARD_CHANGED_ON_DRAFT)
  }
  const refusal = ticketRefusal(card)
  if (refusal !== null) {
    throw new Error(refusal)
  }
  const template = loadTicketTemplate(deps.skillDirs())
  const snapshot = deps.store.inbox.currentDetails(id)?.snapshot
  const images = snapshot ? ticketImages(snapshot.bundle) : []
  const run = runFieldsOf(deps.store, card)
  const fields = ticketFields(deps, card, run, images)
  const frozen = frozenDraftFor(deps.store, card.id)
  return {
    title: renderTemplate(template.defaults.title, fields).text,
    body: renderTicketBody(template.body, fields),
    team: template.defaults.team,
    state: template.defaults.state,
    priority: template.defaults.priority,
    labels: template.defaults.labels,
    assignee: 'me',
    images,
    link: mrLink(run),
    ticketedBefore: ticketedBeforeFor(deps.store, [card]).get(card.id) ?? null,
    templatePath: template.path,
    digest: card.digest,
    ...(frozen ? { frozen } : {})
  }
}
