import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { usageCsv } from './csv'
import { withFrontmatter } from './note'
import { localIsoMinute, type LegacyReport, type UsageReport } from './report'

export const REPORT_FILES = {
  json: 'usage.json',
  js: 'usage-data.js',
  csv: 'usage.csv',
  html: 'Token usage.html',
  note: 'Token usage.md'
} as const
// Job 08's last usage.json, copied here when it is retired (Task 36). Its presence hands the folder to Pilot.
export const LEGACY_FILE = 'usage-legacy.json'

// Report files have fixed names inside the folder; a symlink planted at one (or at its temp file) would send the
// write elsewhere, so it is refused rather than followed.
function assertNotSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Refusing to write ${path}: it is a symlink`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

function writeAtomic(path: string, write: (tmp: string) => void): void {
  const tmp = `${path}.tmp`
  assertNotSymlink(path)
  assertNotSymlink(tmp)
  write(tmp)
  renameSync(tmp, path)
}

function writeTextAtomic(path: string, text: string): void {
  writeAtomic(path, (tmp) => writeFileSync(tmp, text))
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

// null when the folder hasn't been handed over. A file that is there but can't be read stops the write: a
// report without job 08's history would shrink every all-time total.
export function readLegacy(dir: string): LegacyReport | null {
  const path = join(dir, LEGACY_FILE)
  if (!existsSync(path)) {
    return null
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `${LEGACY_FILE} can't be read: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return { jobs: listOf(data.jobs), rows: listOf(data.rows), gaps: listOf(data.gaps) }
}

// A folder that already holds other files is only written into when it is a report folder, so a wrong --out can't
// overwrite files in a repo.
const MARKERS: string[] = [REPORT_FILES.json, REPORT_FILES.note, LEGACY_FILE]

function assertReportFolder(dir: string): void {
  if (!existsSync(dir)) {
    return
  }
  const names = readdirSync(dir)
  if (names.length > 0 && !names.some((n) => MARKERS.includes(n))) {
    throw new Error(
      `${dir} isn't a report folder (it holds other files and no ${REPORT_FILES.json}): pick an empty folder`
    )
  }
}

// usage.py write_data: usage.json (indent 1), the same JSON as usage-data.js for the page opened from disk,
// usage.csv, and the HTML report copied from its template (none without one).
export function writeReportFiles(
  dir: string,
  report: UsageReport,
  templatePath: string | null
): string[] {
  assertReportFolder(dir)
  mkdirSync(dir, { recursive: true })
  const text = JSON.stringify(report, null, 1)
  const json = join(dir, REPORT_FILES.json)
  const js = join(dir, REPORT_FILES.js)
  const csv = join(dir, REPORT_FILES.csv)
  writeTextAtomic(json, `${text}\n`)
  writeTextAtomic(js, `window.USAGE_DATA = ${text};\n`)
  writeTextAtomic(csv, usageCsv(report.rows))
  const written = [json, js, csv]
  if (templatePath !== null && existsSync(templatePath)) {
    const html = join(dir, REPORT_FILES.html)
    writeAtomic(html, (tmp) => copyFileSync(templatePath, tmp))
    written.push(html)
  }
  return written
}

export function writeUsageNote(dir: string, body: string, now: number): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, REPORT_FILES.note)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  writeTextAtomic(path, withFrontmatter(existing, body, localIsoMinute(now), basename(dir)))
  return path
}
