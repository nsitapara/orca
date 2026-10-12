import { describe, expect, it } from 'vitest'
import { renderUsageNote, vaultPrefixOf, withFrontmatter } from './note'
import type { UsageReport } from './report'

const DIR = '/Users/me/Documents/WebPortal/Agent Work/Automations/08 · Tally token usage by job'
const TODAY = new Date(2026, 9, 11, 12, 0)
const report: UsageReport = {
  generated_at: '2026-10-11T12:00:00-07:00',
  price_note: 'the API-equivalent.',
  jobs: [{ key: 'ci-fix-sweep', name: '05 · Fix failed CI on my MRs' }],
  rows: [
    {
      day: '2026-10-11',
      job: 'ci-fix-sweep',
      job_name: '05 · Fix failed CI on my MRs',
      source: 'pilot',
      agent: 'claude',
      model: 'm',
      session: 'a',
      worktree: 'w',
      cwd: '/w',
      started: '2026-10-11T10:00',
      title: 't',
      requests: 1,
      input: 1_000_000,
      cache_read: 0,
      cache_write: 0,
      output: 0,
      tokens: 1_000_000,
      cost_usd: 1234.5
    },
    {
      day: '2026-09-01',
      job: 'new-thing',
      job_name: 'Brand new',
      source: 'pilot',
      agent: 'codex',
      model: 'x',
      session: 'b',
      worktree: 'w',
      cwd: '/w',
      started: '2026-09-01T10:00',
      title: 't',
      requests: 1,
      input: 500,
      cache_read: 0,
      cache_write: 0,
      output: 0,
      tokens: 500,
      cost_usd: null
    }
  ],
  pending: 1,
  gaps: [
    {
      job: 'ci-fix-sweep',
      job_name: '05 · Fix failed CI on my MRs',
      source: 'pilot',
      agent: 'codex',
      at: '2026-10-11T09:00',
      worktree: 'web-1',
      title: ''
    }
  ],
  unpriced_models: ['x'],
  not_counted: 'Not counted: …'
}

describe('renderUsageNote', () => {
  const note = renderUsageNote(report, DIR, TODAY, '2026-10-11 12:00')

  it('totals each job over today, 7 days, 30 days and all time, with vault links for vault jobs', () => {
    expect(note).toContain(
      '| [[Agent Work/Automations/05 · Fix failed CI on my MRs/05 · Fix failed CI on my MRs|05 · Fix failed CI on my MRs]] | $1,234.50 · 1.0M | $1,234.50 · 1.0M | $1,234.50 · 1.0M | $1,234.50 · 1.0M |'
    )
    expect(note).toContain('| new-thing | — | — | — | $0.00 · 500 |')
    expect(note).toContain(
      '| **All jobs** | $1,234.50 · 1.0M | $1,234.50 · 1.0M | $1,234.50 · 1.0M | $1,234.50 · 1.0M |'
    )
  })

  it('says where the numbers come from, then the gaps', () => {
    expect(note).toContain('Counting starts 2026-09-01. Last refresh 2026-10-11 12:00.')
    expect(note).toContain(
      '[usage.csv](file:///Users/me/Documents/WebPortal/Agent%20Work/Automations/08%20%C2%B7%20Tally%20token%20usage%20by%20job/usage.csv)'
    )
    expect(note).toContain('- 1 agent step(s) still running or waiting to be measured.')
    expect(note).toContain(
      '- No session found for [[Agent Work/Automations/05 · Fix failed CI on my MRs/05 · Fix failed CI on my MRs|05 · Fix failed CI on my MRs]] pilot at 2026-10-11 09:00 in `web-1` (codex).'
    )
    expect(note).toContain("- No price in Orca's table, so cost leaves them out: x.")
  })

  it('finds the vault-relative Automations folder', () => {
    expect(vaultPrefixOf(DIR)).toBe('Agent Work/Automations')
  })
})

describe('withFrontmatter', () => {
  it('creates created/updated and provenance for a new note', () => {
    expect(
      withFrontmatter(null, 'Body\n', '2026-10-11T12:00', '08 · Tally token usage by job')
    ).toBe(
      '---\ncreated: 2026-10-11T12:00\nupdated: 2026-10-11T12:00\nautomation: 08 · Tally token usage by job\nskill: agent-usage\n---\n\nBody\n'
    )
  })

  it('bumps only `updated` on an existing note and replaces its body', () => {
    const old =
      '---\ncreated: 2026-10-08T21:15\nupdated: 2026-10-10T09:50\nautomation: 08 · Tally token usage by job\ntags: [usage]\n---\n\nOld body\n'
    expect(withFrontmatter(old, 'New\n', '2026-10-11T12:00', 'x')).toBe(
      '---\ncreated: 2026-10-08T21:15\nupdated: 2026-10-11T12:00\nautomation: 08 · Tally token usage by job\ntags: [usage]\n---\n\nNew\n'
    )
  })
})
