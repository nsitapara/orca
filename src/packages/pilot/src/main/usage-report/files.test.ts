import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_FILE, readLegacy, writeReportFiles, writeUsageNote } from './files'
import type { UsageReport } from './report'

const report: UsageReport = {
  generated_at: '2026-10-11T12:00:00-07:00',
  price_note: 'p',
  jobs: [],
  rows: [],
  pending: 0,
  gaps: [],
  unpriced_models: [],
  not_counted: 'n'
}
const tmp = (): string => mkdtempSync(join(tmpdir(), 'pilot-report-'))

describe('writeReportFiles', () => {
  it('writes usage.json, usage-data.js, usage.csv and copies the HTML template', () => {
    const dir = tmp()
    const template = join(tmp(), 'usage_report.html')
    writeFileSync(template, '<html>report</html>')
    const written = writeReportFiles(dir, report, template)
    expect(written.map((p) => p.slice(dir.length + 1))).toEqual([
      'usage.json',
      'usage-data.js',
      'usage.csv',
      'Token usage.html'
    ])
    expect(JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8'))).toEqual(report)
    expect(readFileSync(join(dir, 'usage-data.js'), 'utf8')).toMatch(
      /^window\.USAGE_DATA = \{\n "generated_at"/
    )
    expect(readFileSync(join(dir, 'Token usage.html'), 'utf8')).toBe('<html>report</html>')
  })

  it('skips the HTML when the template is missing, and leaves no temp files', () => {
    const dir = tmp()
    expect(writeReportFiles(dir, report, '/no/template.html')).toHaveLength(3)
    expect(existsSync(join(dir, 'usage.json.tmp'))).toBe(false)
  })
})

describe('readLegacy', () => {
  it.each([
    ['missing', null, null],
    [
      'the hand-over copy of usage.json',
      JSON.stringify({ ...report, jobs: [{ key: 'k', name: 'n' }] }),
      { jobs: [{ key: 'k', name: 'n' }], rows: [], gaps: [] }
    ]
  ])('%s', (_name, content, expected) => {
    const dir = tmp()
    if (content !== null) {
      writeFileSync(join(dir, LEGACY_FILE), content)
    }
    expect(readLegacy(dir)).toEqual(expected)
  })

  it('refuses a corrupt file rather than writing a report without the history', () => {
    const dir = tmp()
    writeFileSync(join(dir, LEGACY_FILE), '{ nope')
    expect(() => readLegacy(dir)).toThrow(/usage-legacy\.json can't be read/)
  })
})

describe('writeUsageNote', () => {
  it('creates the note with frontmatter, then keeps it on the next write', () => {
    const dir = join(tmp(), '08 · Tally token usage by job')
    const path = writeUsageNote(dir, 'One\n', new Date(2026, 9, 11, 12, 0).getTime())
    expect(readFileSync(path, 'utf8')).toContain(
      'created: 2026-10-11T12:00\nupdated: 2026-10-11T12:00\nautomation: 08 · Tally token usage by job'
    )
    writeUsageNote(dir, 'Two\n', new Date(2026, 9, 11, 13, 0).getTime())
    expect(readFileSync(path, 'utf8')).toMatch(
      /created: 2026-10-11T12:00\nupdated: 2026-10-11T13:00[\s\S]*\n\nTwo\n$/
    )
  })
})

describe('writeReportFiles safety', () => {
  it('is idempotent: the same report writes the same bytes', () => {
    const dir = tmp()
    const read = (): string[] =>
      writeReportFiles(dir, report, '/no/template.html').map((p) => readFileSync(p, 'utf8'))
    expect(read()).toEqual(read())
  })

  it('never writes through a symlink planted at a report file name', () => {
    const dir = tmp()
    const elsewhere = join(tmp(), 'victim.txt')
    writeFileSync(elsewhere, 'keep')
    symlinkSync(elsewhere, join(dir, 'usage.json'))
    expect(() => writeReportFiles(dir, report, '/no/template.html')).toThrow(/symlink/)
    expect(readFileSync(elsewhere, 'utf8')).toBe('keep')
  })
})

describe('writeReportFiles refuses a folder that is not a report folder', () => {
  it('leaves a non-empty directory with no report files untouched', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'usage.json'.replace('usage', 'package')), 'mine')
    expect(() => writeReportFiles(dir, report, '/no/template.html')).toThrow(
      /isn't a report folder/
    )
    expect(existsSync(join(dir, 'usage.json'))).toBe(false)
  })

  it.each(['usage.json', 'Token usage.md', LEGACY_FILE])(
    'writes when the folder already holds %s',
    (name) => {
      const dir = tmp()
      writeFileSync(join(dir, name), '{}')
      expect(() => writeReportFiles(dir, report, '/no/template.html')).not.toThrow()
    }
  )
})
