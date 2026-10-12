import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { jobCode } from '../../shared/job-name'
import { fmtTokens } from '../../shared/money'
import { localDay } from '../usage/buckets'
import type { UsageReport, UsageRow } from './report'

const WINDOWS: (number | null)[] = [0, 6, 29, null]

// Python's f"${x:,.2f}": the exact binary value rounds to the nearest cent, and an exact tie (only j/8 with j odd
// can be one) goes to the even cent. toFixed picks the larger cent on a tie, so ties are settled here.
export function moneyCommas(usd: number): string {
  const abs = Math.abs(usd)
  const eighths = abs * 8
  let cents = Math.round(Number(abs.toFixed(2)) * 100)
  if (Number.isInteger(eighths) && eighths % 2 === 1) {
    const down = Math.floor(abs * 100)
    cents = down % 2 === 0 ? down : down + 1
  }
  const sign = usd < 0 ? '-' : ''
  return `$${sign}${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dayBack(today: Date, back: number): string {
  return localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime())
}

function cell(
  rows: readonly UsageRow[],
  job: string | null,
  back: number | null,
  today: Date
): string {
  const since = back === null ? '' : dayBack(today, back)
  const mine = rows.filter((r) => (job === null || r.job === job) && r.day >= since)
  if (mine.length === 0) {
    return '—'
  }
  const cost = mine.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
  const tokens = mine.reduce((sum, r) => sum + r.tokens, 0)
  return `${moneyCommas(cost)} · ${fmtTokens(tokens)}`
}

// The report folder is <vault>/<…>/Automations/<job>; links are written from the vault root.
export function vaultPrefixOf(dir: string): string {
  const automations = dirname(dir)
  return relative(dirname(dirname(automations)), automations)
    .split('\\')
    .join('/')
}

// usage.py's _job_label: a vault job links to its job note; anything else shows its key.
function jobLabel(key: string, report: UsageReport, prefix: string): string {
  const name = report.jobs.find((j) => j.key === key)?.name
  if (!name || jobCode(name) === null) {
    return key
  }
  return `[[${prefix}/${name}/${name}|${name}]]`
}

function firstDay(rows: readonly UsageRow[], today: Date): string {
  if (rows.length === 0) {
    return localDay(today.getTime())
  }
  return rows.reduce((min, r) => (r.day < min ? r.day : min), rows[0].day)
}

// usage.py's render_note, refreshed by Pilot instead of job 08.
export function renderUsageNote(
  report: UsageReport,
  dir: string,
  today: Date,
  stamp: string
): string {
  const prefix = vaultPrefixOf(dir)
  const uri = (name: string): string => pathToFileURL(join(dir, name)).href
  const known = report.jobs.map((j) => j.key)
  const extra = [...new Set(report.rows.map((r) => r.job))].filter((k) => !known.includes(k)).sort()
  const out = [
    '# Token usage by job',
    '',
    `> Totals from the agents' own session logs, refreshed by Pilot after each run and hourly (\`pilot automations usage-report\`). Cost is ${report.price_note} Counting starts ${firstDay(report.rows, today)}. Last refresh ${stamp}.`,
    '',
    `**Report:** [Token usage.html](${uri('Token usage.html')}) · **Data:** [usage.csv](${uri('usage.csv')}), [usage.json](${uri('usage.json')})`,
    '',
    '## Totals',
    '',
    '| Job | Today | 7 days | 30 days | All time |',
    '|---|---:|---:|---:|---:|'
  ]
  for (const job of [...known, ...extra]) {
    out.push(
      `| ${jobLabel(job, report, prefix)} | ${WINDOWS.map((b) => cell(report.rows, job, b, today)).join(' | ')} |`
    )
  }
  out.push(
    `| **All jobs** | ${WINDOWS.map((b) => cell(report.rows, null, b, today)).join(' | ')} |`
  )
  out.push('', '## Gaps', '', `- ${report.not_counted}`)
  if (report.pending > 0) {
    out.push(`- ${report.pending} agent step(s) still running or waiting to be measured.`)
  }
  for (const g of report.gaps.slice(-15)) {
    out.push(
      `- No session found for ${jobLabel(g.job, report, prefix)} ${g.source} at ${g.at.replace('T', ' ')} in \`${g.worktree}\` (${g.title || g.agent}).`
    )
  }
  if (report.unpriced_models.length > 0) {
    out.push(
      `- No price in Orca's table, so cost leaves them out: ${report.unpriced_models.join(', ')}.`
    )
  }
  return `${out.join('\n')}\n`
}

// vault.touch_note's frontmatter. A new note gets created/updated and provenance; an existing one keeps every
// frontmatter line except `updated`, and its body is replaced (usage.py write_note).
export function withFrontmatter(
  existing: string | null,
  body: string,
  nowStamp: string,
  automation: string
): string {
  const end = existing?.startsWith('---\n') ? existing.indexOf('\n---\n', 4) : -1
  if (existing === null || end === -1) {
    return `---\ncreated: ${nowStamp}\nupdated: ${nowStamp}\nautomation: ${automation}\nskill: agent-usage\n---\n\n${body}`
  }
  const lines = existing
    .slice(4, end)
    .split('\n')
    .map((l) => (l.startsWith('updated:') ? `updated: ${nowStamp}` : l))
  if (!lines.some((l) => l.startsWith('updated:'))) {
    lines.push(`updated: ${nowStamp}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}
