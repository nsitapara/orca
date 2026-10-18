import { basename } from 'node:path'
import { vaultJobName } from '../../shared/job-name'
import type { ReportBucketRow, SessionlessStep } from '../store/store-spend'

// usage.json's shapes, field for field (usage.py rows(), tally()). The report page (resources/usage_report.html) reads
// these names.
export type UsageRow = {
  day: string
  job: string
  job_name: string
  source: string
  agent: string
  model: string
  session: string
  worktree: string
  cwd: string
  started: string
  title: string
  requests: number
  input: number
  cache_read: number
  cache_write: number
  output: number
  tokens: number
  cost_usd: number | null
}
export type UsageGap = {
  job: string
  job_name: string
  source: string
  agent: string
  at: string
  worktree: string
  title: string
}
export type UsageJob = { key: string; name: string }
export type UsageReport = {
  generated_at: string
  price_note: string
  jobs: UsageJob[]
  rows: UsageRow[]
  pending: number
  gaps: UsageGap[]
  unpriced_models: string[]
  not_counted: string
}
export type LegacyReport = { jobs: UsageJob[]; rows: UsageRow[]; gaps: UsageGap[] }
export type ReportInput = {
  buckets: readonly ReportBucketRow[]
  sessionless: readonly SessionlessStep[]
  pending: number
  automations: readonly { id: string; name: string }[]
  legacy: LegacyReport | null
  now: number
}

export const PRICE_NOTE =
  'the API-equivalent at the price tables Pilot shares with Orca: what these tokens would cost on the API, not what the subscriptions bill.'
export const NOT_COUNTED =
  "Not counted: separate sessions that a job's agent or a hook starts on its own: `claude -p`, `codex exec` and Cursor runs (job 03's orchestrated phases run as these) and the security-guidance plugin's `sdk-py` reviews. Anything typed by hand into a job's tab counts toward that job."

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Python's datetime.fromtimestamp(...).isoformat(timespec="minutes"): local time, no offset.
export function localIsoMinute(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// Python's datetime.now().astimezone().isoformat(timespec="seconds").
export function localIsoSeconds(ms: number): string {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${localIsoMinute(ms)}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6

function folderName(path: string | null): string {
  return path ? basename(path) : ''
}

// A ported automation keeps the job key and name usage.py gave its job, so its history and its new rows group
// together; an automation only Pilot has is keyed by its id.
export function jobResolver(
  automations: readonly { id: string; name: string }[],
  legacyJobs: readonly UsageJob[]
): (automationId: string) => UsageJob {
  const names = legacyJobs.map((j) => j.name)
  const byId = new Map<string, UsageJob>()
  for (const a of automations) {
    const vault = vaultJobName(a.name, names)
    const legacy = legacyJobs.find((j) => j.name === vault)
    byId.set(a.id, { key: legacy?.key ?? a.id, name: vault ?? a.name })
  }
  return (id) => byId.get(id) ?? { key: id, name: id }
}

// A session's rows all carry the start, title and cwd of its earliest step (usage.py keeps one `started` per session).
function earliestStepPerSession(buckets: readonly ReportBucketRow[]): Map<string, ReportBucketRow> {
  const first = new Map<string, ReportBucketRow>()
  for (const b of buckets) {
    const seen = first.get(b.sessionId)
    if (!seen || b.stepStartedAt < seen.stepStartedAt) {
      first.set(b.sessionId, b)
    }
  }
  return first
}

function pilotRows(
  buckets: readonly ReportBucketRow[],
  jobOf: (id: string) => UsageJob
): UsageRow[] {
  const first = earliestStepPerSession(buckets)
  const merged = new Map<string, UsageRow>()
  // Raw costs are added and rounded once at the end, as usage.py does; null once any part has no price.
  const rawCost = new Map<string, number | null>()
  for (const b of buckets) {
    const tokens = b.input + b.cacheRead + b.cacheWrite + b.output
    const key = `${b.sessionId}|${b.day}|${b.model}`
    const old = merged.get(key)
    if (old) {
      old.requests += b.requests
      old.input += b.input
      old.cache_read += b.cacheRead
      old.cache_write += b.cacheWrite
      old.output += b.output
      old.tokens += tokens
      const sum = rawCost.get(key) ?? null
      rawCost.set(key, sum === null || b.costUsd === null ? null : sum + b.costUsd)
      continue
    }
    const job = jobOf(b.automationId)
    const start = first.get(b.sessionId) ?? b
    rawCost.set(key, b.costUsd)
    merged.set(key, {
      day: b.day,
      job: job.key,
      job_name: job.name,
      source: 'pilot',
      agent: b.agent,
      model: b.model,
      session: b.sessionId,
      worktree: folderName(start.worktreePath),
      cwd: start.worktreePath ?? '',
      started: localIsoMinute(start.stepStartedAt),
      title: start.itemLabel,
      requests: b.requests,
      input: b.input,
      cache_read: b.cacheRead,
      cache_write: b.cacheWrite,
      output: b.output,
      tokens,
      cost_usd: null
    })
  }
  for (const [key, row] of merged) {
    const cost = rawCost.get(key) ?? null
    row.cost_usd = cost === null ? null : round6(cost)
  }
  return [...merged.values()]
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

// usage.py sorts rows by (day, started, model).
function byDayStartedModel(a: UsageRow, b: UsageRow): number {
  return (
    compareText(a.day, b.day) || compareText(a.started, b.started) || compareText(a.model, b.model)
  )
}

export function buildUsageReport(input: ReportInput): UsageReport {
  const legacy = input.legacy ?? { jobs: [], rows: [], gaps: [] }
  const jobOf = jobResolver(input.automations, legacy.jobs)
  const mine = pilotRows(input.buckets, jobOf)
  const measured = new Set(mine.map((r) => r.session))
  const rows = [...legacy.rows.filter((r) => !measured.has(r.session)), ...mine].sort(
    byDayStartedModel
  )
  const gaps: UsageGap[] = [
    ...legacy.gaps,
    ...input.sessionless.map((s) => {
      const job = jobOf(s.automationId)
      return {
        job: job.key,
        job_name: job.name,
        source: 'pilot',
        agent: s.agent,
        at: localIsoMinute(s.startedAt),
        worktree: folderName(s.worktreePath),
        title: s.itemLabel
      }
    })
  ]
  const jobs = [...legacy.jobs]
  for (const a of input.automations) {
    const job = jobOf(a.id)
    if (!jobs.some((j) => j.key === job.key)) {
      jobs.push(job)
    }
  }
  return {
    generated_at: localIsoSeconds(input.now),
    price_note: PRICE_NOTE,
    jobs,
    rows,
    pending: input.pending,
    gaps,
    unpriced_models: [
      ...new Set(rows.filter((r) => r.cost_usd === null).map((r) => r.model))
    ].sort(),
    not_counted: NOT_COUNTED
  }
}
