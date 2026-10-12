import type { UsageRow } from './report'

// usage.py's CSV_FIELDS: every row field but cwd, in this order.
export const CSV_FIELDS = [
  'day',
  'job',
  'job_name',
  'source',
  'agent',
  'model',
  'session',
  'worktree',
  'started',
  'title',
  'requests',
  'input',
  'cache_read',
  'cache_write',
  'output',
  'tokens',
  'cost_usd'
] as const

// Python csv's QUOTE_MINIMAL: quote a field holding a comma, a quote or a line break; double inner quotes.
function cell(value: string | number | null): string {
  if (value === null) {
    return ''
  }
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

// csv.DictWriter ends every line with \r\n.
export function usageCsv(rows: readonly UsageRow[]): string {
  const lines = [
    CSV_FIELDS.join(','),
    ...rows.map((r) => CSV_FIELDS.map((f) => cell(r[f])).join(','))
  ]
  return lines.map((l) => `${l}\r\n`).join('')
}
