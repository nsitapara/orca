import {
  symlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import { LEGACY_FILE } from './files'
import { isReportDue, USAGE_REFRESH_MS, createUsageReporter } from './reporter'

function deps(withLegacy: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'pilot-reporter-'))
  const dir = join(root, 'Agent Work', 'Automations', '08 · Tally token usage by job')
  const store = PilotStore.open(join(root, 'db.sqlite'))
  if (withLegacy) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, LEGACY_FILE), JSON.stringify({ jobs: [], rows: [], gaps: [] }))
  }
  const log = vi.fn()
  return {
    dir,
    root,
    log,
    deps: {
      store,
      automations: () => [],
      dir,
      templatePath: '/no/template.html',
      now: () => 1_000,
      log
    }
  }
}

describe('isReportDue', () => {
  it.each([
    ['never written', null, null, 5, true],
    ['an hour since the last write', 0, null, USAGE_REFRESH_MS, true],
    ['a step was measured since', 100, 150, 200, true],
    ['nothing new, within the hour', 100, 50, 200, false]
  ])('%s', (_name, last, measured, now, due) => {
    expect(isReportDue(last, measured, now)).toBe(due)
  })
})

describe('createUsageReporter', () => {
  it('stays dormant until job 08 hands the report over, and says so once', () => {
    const { dir, log, deps: d } = deps(false)
    const reporter = createUsageReporter(d)
    reporter.refreshIfDue()
    reporter.refreshIfDue()
    expect(existsSync(join(dir, 'usage.json'))).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('waiting for the hand-over from job 08')
  })

  it('refreshes once handed over, and not again until something changes', () => {
    const { dir, deps: d } = deps(true)
    const reporter = createUsageReporter(d)
    reporter.refreshIfDue()
    expect(existsSync(join(dir, 'usage.json'))).toBe(true)
    expect(existsSync(join(dir, 'Token usage.md'))).toBe(true)
    rmSync(join(dir, 'usage.json'))
    reporter.refreshIfDue()
    expect(existsSync(join(dir, 'usage.json'))).toBe(false)
  })

  it('refuses to write into job 08 folder before the hand-over, but writes anywhere else', () => {
    const { root, deps: d } = deps(false)
    const reporter = createUsageReporter(d)
    expect(() => reporter.write()).toThrow(/Job 08 still owns/)
    const out = join(root, 'parity')
    expect(reporter.write(out)).toMatchObject({ dir: out, rows: 0, sessions: 0, costUsd: 0 })
    expect(existsSync(join(out, 'usage.csv'))).toBe(true)
  })

  it('writes the same files again when asked twice (idempotent)', () => {
    const { dir, deps: d } = deps(true)
    const reporter = createUsageReporter(d)
    reporter.write()
    const first = readFileSync(join(dir, 'usage.csv'), 'utf8')
    reporter.write()
    expect(readFileSync(join(dir, 'usage.csv'), 'utf8')).toBe(first)
  })

  it('sees a symlinked alias of the job 08 folder as the same folder', () => {
    const { root, dir, deps: d } = deps(false)
    mkdirSync(dir, { recursive: true })
    const alias = join(root, 'alias')
    symlinkSync(dir, alias)
    expect(() => createUsageReporter(d).write(alias)).toThrow(/Job 08 still owns/)
  })
})
