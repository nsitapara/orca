import { resolve } from 'node:path'
import type { CommandHandler } from '../../../../cli/dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import { RuntimeClientError } from '../../../../cli/runtime/types'
import type { SpendGroup, SpendPayload, SpendRow, UsageReportResult } from '../shared/api-types'
import { fmtTokens, money } from '../shared/money'

const GROUPS: readonly SpendGroup[] = ['automation', 'skill', 'agent', 'mr']

function groupFlag(flags: Map<string, string | boolean>): SpendGroup {
  const value = getOptionalStringFlag(flags, 'by') ?? 'automation'
  const group = GROUPS.find((g) => g === value)
  if (!group) {
    throw new RuntimeClientError('invalid_argument', `--by must be one of ${GROUPS.join(', ')}`)
  }
  return group
}

function runWord(n: number): string {
  return n === 1 ? 'run ' : 'runs'
}

function line(costUsd: number | null, tokens: number, runs: number, label: string): string {
  return `  ${money(costUsd).padStart(9)}  ${fmtTokens(tokens).padStart(6)} tokens  ${String(runs).padStart(3)} ${runWord(runs)}  ${label}`
}

function unpricedNote(r: SpendRow): string {
  return r.unpricedBuckets > 0 ? ' (some models have no price)' : ''
}

// A run can have steps in several skills or agents, so those groups' run counts needn't add up to the total's.
function totalLabel(by: SpendGroup): string {
  if (by === 'skill' || by === 'agent') {
    return 'total (runs counted once)'
  }
  return 'total'
}

export function formatSpend(p: SpendPayload): string {
  const head = `Spend since ${p.sinceDay} (last ${p.days} ${p.days === 1 ? 'day' : 'days'}), by ${p.by}`
  if (p.rows.length === 0) {
    return `${head}\n  Nothing spent in this window.`
  }
  return [
    head,
    ...p.rows.map((r) => line(r.costUsd, r.tokens, r.runs, `${r.label}${unpricedNote(r)}`)),
    line(p.total.costUsd, p.total.tokens, p.total.runs, totalLabel(p.by))
  ].join('\n')
}

const REPORT_TIMEOUT_MS = 120_000

export function formatUsageReport(r: UsageReportResult): string {
  return `Wrote ${r.files.length} files to ${r.dir}: ${r.sessions} sessions, ${r.rows} rows, ${money(r.costUsd)}`
}

export const PILOT_SPEND_HANDLERS: Record<string, CommandHandler> = {
  'automations spend': async ({ flags, client, json }) => {
    const params = { by: groupFlag(flags), days: getOptionalPositiveIntegerFlag(flags, 'days') }
    printResult(await client.call<SpendPayload>('pilot.spend', params), json, formatSpend)
  },
  'automations usage-report': async ({ flags, client, json }) => {
    const out = getOptionalStringFlag(flags, 'out')
    const params = out ? { dir: resolve(out) } : {}
    printResult(
      await client.call<UsageReportResult>('pilot.usage.writeReport', params, {
        timeoutMs: REPORT_TIMEOUT_MS
      }),
      json,
      formatUsageReport
    )
  }
}
