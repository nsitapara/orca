import type { InboxItemRow, InboxListPayload, InboxOption } from '../shared/api-types'

function optionLine(option: InboxOption, n: number): string {
  if (option.meaning) {
    return `    ${n}. ${option.label} — ${option.meaning}`
  }
  return `    ${n}. ${option.label}`
}

function whose(item: InboxItemRow): string {
  const parts = [item.automationId, item.itemKey].filter((p): p is string => Boolean(p))
  if (parts.length === 0) {
    return ''
  }
  return `  (${parts.join(' · ')})`
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
