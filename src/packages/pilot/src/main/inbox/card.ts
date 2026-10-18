import { createHash } from 'node:crypto'
import type { InboxItemRow, InboxOption, InboxType } from '../../shared/api-types'
import { DETAILS_EITHER, type DetailsRef } from '../../shared/details'
import type { InboxAddParams, InboxItemSummary } from '../../shared/inbox-types'

export type InboxCard = {
  type: InboxType
  title: string
  context: string
  suggested: string | null
  options: InboxOption[]
  detailsMd: string | null
  // The card's Details bundle (its path, its bytes' SHA-256 and each inlined review's), or null.
  details: DetailsRef | null
  action: string | null
  actionArgs: Record<string, unknown> | null
}

export const MAX_DETAILS_CHARS = 64 * 1024
export const MAX_ACTION_ARGS_BYTES = 16 * 1024
export const MAX_OPTIONS = 10

// One line, like vault.py's _clean: a card reads the same on the page, in the vault export and in a prompt.
export function oneLine(text: string | null | undefined): string {
  return (text ?? '').split(/\s+/).filter(Boolean).join(' ')
}

// A control character (C0, DEL, C1, or a Unicode line break) could end a typed prompt's line or hide words
// in it: a Details bundle's path may hold none, and the answers prompt escapes every one it quotes.
export function isPromptControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}

// "<label> — <meaning>", the way card.py and `pilot inbox add --option` write an option (vault.py _options).
export function parseOption(raw: string): InboxOption | null {
  const text = oneLine(raw)
  const at = text.indexOf(' — ')
  if (at === -1) {
    return text ? { label: text, meaning: '' } : null
  }
  const label = text.slice(0, at).trim()
  return label ? { label, meaning: text.slice(at + 3).trim() } : null
}

export { DETAILS_EITHER }

// A card's Details are markdown or a bundle, never both: checked before a bundle is read.
export function checkDetailsChoice(params: InboxAddParams): void {
  if (params.detailsMd !== undefined && params.detailsBundlePath !== undefined) {
    throw new Error(DETAILS_EITHER)
  }
}

function checkCard(params: InboxAddParams): void {
  checkDetailsChoice(params)
  if (!oneLine(params.title)) {
    throw new Error('A card needs a title')
  }
  if (params.action && params.type !== 'action') {
    throw new Error('Only an action card can carry an action')
  }
  if (params.actionArgs && !params.action) {
    throw new Error('Action arguments need an action')
  }
  if ((params.options?.length ?? 0) > MAX_OPTIONS) {
    throw new Error(`A card can have at most ${MAX_OPTIONS} options`)
  }
  if (params.actionArgs && JSON.stringify(params.actionArgs).length >= MAX_ACTION_ARGS_BYTES) {
    throw new Error('Action arguments are limited to 16 KB')
  }
  if ((params.detailsMd?.length ?? 0) > MAX_DETAILS_CHARS) {
    throw new Error('Details are limited to 64 KB')
  }
}

// `details` is the ref of the bundle loadDetails read for these params (null without one).
export function buildCard(params: InboxAddParams, details: DetailsRef | null = null): InboxCard {
  checkCard(params)
  return {
    type: params.type,
    title: oneLine(params.title),
    context: oneLine(params.context),
    suggested: oneLine(params.suggested) || null,
    options: (params.options ?? []).map(parseOption).filter((o): o is InboxOption => o !== null),
    detailsMd: params.detailsMd?.trim() ? params.detailsMd : null,
    details,
    action: params.action ?? null,
    actionArgs: params.action ? (params.actionArgs ?? {}) : null
  }
}

export function cardOf(item: InboxItemRow): InboxCard {
  const { type, title, context, suggested, options, detailsMd, details, action, actionArgs } = item
  return { type, title, context, suggested, options, detailsMd, details, action, actionArgs }
}

// What an answer approves (contract §10): type, title, context, options, action and its pinned args (an object).
// Details join only when present (E3), so a plain card keeps the six-field digest. A bundle joins as its path, its bytes' SHA-256 and each inlined review text's, so an approval binds to
// exactly what was shown; a card without one hashes as before. The suggestion and replies never count.
export function inboxDigest(card: InboxCard): string {
  const fields: unknown[] = [
    card.type,
    card.title,
    card.context,
    card.options,
    card.action,
    card.actionArgs
  ]
  if (card.detailsMd) {
    fields.push(card.detailsMd)
  }
  if (card.details) {
    fields.push([
      'details',
      card.details.path,
      card.details.sha256,
      Object.entries(card.details.inlined).sort()
    ])
  }
  if (card.details?.artifacts) {
    fields.push([
      'artifacts',
      card.details.artifacts.files.map((file) => [file.ref, file.role, file.sha256])
    ])
  }
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}

export function toInboxSummary(row: InboxItemRow): InboxItemSummary {
  const {
    id,
    automationId,
    runId,
    stepIdx,
    itemKey,
    worktreePath,
    person,
    type,
    title,
    context,
    status,
    createdAt
  } = row
  return {
    id,
    automationId,
    runId,
    stepIdx,
    itemKey,
    worktreePath,
    person,
    type,
    title,
    context,
    status,
    createdAt
  }
}
