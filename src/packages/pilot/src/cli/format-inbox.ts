import type { InboxItemRow, InboxListPayload, InboxListRow, InboxOption } from '../shared/api-types'
import type { DetailsRef } from '../shared/details'

function optionLine(option: InboxOption, n: number): string {
  if (option.meaning) {
    return `    ${n}. ${option.label} — ${option.meaning}`
  }
  return `    ${n}. ${option.label}`
}

function whose(item: InboxListRow): string {
  const parts = [item.automationId, item.itemKey].filter((p): p is string => Boolean(p))
  if (parts.length === 0) {
    return ''
  }
  return `  (${parts.join(' · ')})`
}

function bundleLine(ref: DetailsRef): string {
  const parts = [`sha256 ${ref.sha256}`, `${ref.blocks} block${ref.blocks === 1 ? '' : 's'}`]
  if (ref.drafted && ref.draftedBase) {
    parts.push(`drafted at ${ref.draftedBase.slice(0, 8)}`)
  } else if (ref.drafted) {
    parts.push('drafted')
  }
  return `Details: ${ref.path} (${parts.join(', ')})`
}

function detailsLine(item: Pick<InboxItemRow, 'details' | 'detailsMd'>): string {
  if (item.details) {
    return bundleLine(item.details)
  }
  if (item.detailsMd) {
    return 'Details: markdown'
  }
  return 'Details: none'
}

// One card: what it is and where it stands, its title, and where its Details are.
export function formatInboxShow(item: InboxItemRow): string {
  return [
    `${item.id} · ${item.type} · ${item.status} · v${item.version}`,
    item.title,
    detailsLine(item)
  ].join('\n')
}

// One line per card, then its options numbered as `pilot inbox answer --option <n>` takes them.
export function formatInboxList(payload: InboxListPayload): string {
  if (payload.items.length === 0) {
    return 'Nothing is waiting on you.'
  }
  return payload.items
    .flatMap((item) => [
      `${item.id}  ${item.type}  ${item.status}  ${item.title}${whose(item)}`,
      ...item.options.map((option, i) => optionLine(option, i + 1))
    ])
    .join('\n')
}
