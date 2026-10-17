import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReportBucketRow } from '../../src/main/store/store-spend'
import { claudeUsage } from '../../src/main/usage/claude'
import { codexUsage } from '../../src/main/usage/codex'
import { CSV_FIELDS } from '../../src/main/usage-report/csv'
import { readLegacy } from '../../src/main/usage-report/files'
import {
  buildUsageReport,
  type LegacyReport,
  type UsageRow
} from '../../src/main/usage-report/report'
import { PARITY_DIR } from './old-side'

// usage.py buckets by local day and prints local start times; the engine must do the same in Nish's zone.
const TZ = 'America/Los_Angeles'
process.env.TZ = TZ
const CASE = join(PARITY_DIR, '08', 'basic')
const WINDOW = { from: 0, to: Number.MAX_SAFE_INTEGER }
const SAME = [
  'day',
  'job',
  'job_name',
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
  'tokens'
] as const

// The automations that took over the jobs the case's sessions belonged to, by the job key usage.py gave them.
const AUTOMATIONS = [
  { id: 'fix-failed-ci', name: '05 · Fix failed CI on my MRs' },
  { id: 'mr-feedback', name: '06 · Address reviewer feedback on my MRs' },
  { id: 'merge-dev', name: '02 · Merge dev into my MR branches' }
]
const AUTOMATION_OF: Record<string, string> = {
  'ci-fix-sweep': 'fix-failed-ci',
  'mr-feedback-sweep': 'mr-feedback',
  'update-my-mrs': 'merge-dev'
}

type CaseSession = {
  job: string
  agent: 'claude' | 'codex'
  session: string
  cwd: string
  title: string
  at: number
  files: [string, string | null][]
}

// usage.py's own rows for the case's sessions (its parse_claude, parse_codex and rows), frozen in old-rows.json before
// usage.py was deleted, so neither python3 nor usage.py is needed.
function old(): { rows: UsageRow[]; csv_fields: string[] } {
  return JSON.parse(readFileSync(join(CASE, 'old-rows.json'), 'utf8'))
}

// What Task 28 measures from each session's transcripts, as the rows Task 29b reads from the store.
async function buckets(): Promise<ReportBucketRow[]> {
  const kase = JSON.parse(readFileSync(join(CASE, 'case.json'), 'utf8')) as {
    sessions: CaseSession[]
  }
  const rows: ReportBucketRow[] = []
  for (const s of kase.sessions) {
    const files = s.files.map(([rel]) => join(CASE, rel))
    const used =
      s.agent === 'claude'
        ? await claudeUsage(files, WINDOW)
        : (await Promise.all(files.map((f) => codexUsage(f, WINDOW)))).flat()
    for (const b of used) {
      rows.push({
        automationId: AUTOMATION_OF[s.job],
        itemLabel: s.title,
        worktreePath: s.cwd,
        agent: s.agent,
        sessionId: s.session,
        stepStartedAt: s.at * 1000,
        day: b.day,
        model: b.model,
        requests: b.requests,
        input: b.input,
        cacheRead: b.cacheRead,
        cacheWrite: b.cacheWrite,
        output: b.output,
        costUsd: b.costUsd
      })
    }
  }
  return rows
}

async function engine(legacy: LegacyReport) {
  return buildUsageReport({
    buckets: await buckets(),
    sessionless: [],
    pending: 0,
    automations: AUTOMATIONS,
    legacy,
    now: Date.parse('2026-10-11T12:00:00-07:00')
  })
}

const key = (r: UsageRow) => `${r.session}|${r.day}|${r.model}`
const pick = (r: UsageRow) => Object.fromEntries(SAME.map((k) => [k, r[k]]))
const legacy = readLegacy(CASE)!
// The jobs usage.py knew, without its history: so the engine keys each row by the same job.
const JOBS_ONLY: LegacyReport = { jobs: legacy.jobs, rows: [], gaps: [] }

describe('08 · Tally token usage, written by the engine (Tasks 28 and 29)', () => {
  it('writes the same row as usage.py for every session, day and model', async () => {
    const before = old().rows
    const after = (await engine(JOBS_ONLY)).rows
    expect(after.map(key).sort()).toEqual(before.map(key).sort())
    for (const o of before) {
      const n = after.find((r) => key(r) === key(o))!
      expect(pick(n)).toEqual(pick(o))
      if (o.cost_usd === null) {
        expect(n.cost_usd).toBeNull()
      } else {
        expect(n.cost_usd).toBeCloseTo(o.cost_usd, 6)
      }
    }
  })

  it("keeps usage.json's top-level keys and row keys, and lists the unpriced models", async () => {
    const json = await engine(JOBS_ONLY)
    expect(Object.keys(json).sort()).toEqual([
      'gaps',
      'generated_at',
      'jobs',
      'not_counted',
      'pending',
      'price_note',
      'rows',
      'unpriced_models'
    ])
    const unpriced = [
      ...new Set(
        old()
          .rows.filter((r) => r.cost_usd === null)
          .map((r) => r.model)
      )
    ].sort()
    expect(unpriced).toEqual(['claude-mystery-1'])
    expect(json.unpriced_models).toEqual(unpriced)
    expect(Object.keys(json.rows[0]).sort()).toEqual([...CSV_FIELDS, 'cwd'].sort())
  })

  it('keeps the legacy history through the hand-over, minus the sessions the engine reports itself', async () => {
    const rows = (await engine(legacy)).rows
    expect(rows.filter((r) => r.session === 'h-old')).toHaveLength(1)
    const ownS1 = rows.filter((r) => r.session === 's1')
    expect(ownS1.length).toBeGreaterThan(0)
    expect(ownS1.every((r) => r.source === 'pilot')).toBe(true)
  })
})
