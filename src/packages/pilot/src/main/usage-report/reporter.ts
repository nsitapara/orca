import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { UsageReportResult } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import { pilotUsageReportDir, pilotUsageTemplate } from '../env'
import { LEGACY_FILE, readLegacy, writeReportFiles, writeUsageNote } from './files'
import { renderUsageNote } from './note'
import { buildUsageReport, localIsoMinute } from './report'

export const USAGE_REFRESH_MS = 60 * 60_000

export type ReporterDeps = {
  store: PilotStore
  automations: () => { id: string; name: string }[]
  dir: string
  templatePath: string | null
  now: () => number
  log: (message: string) => void
}
export type UsageReporter = { refreshIfDue(): void; write(dir?: string): UsageReportResult }

// After runs (a step was measured since the last write) and at least hourly.
export function isReportDue(
  lastWrittenAt: number | null,
  lastMeasuredAt: number | null,
  now: number
): boolean {
  if (lastWrittenAt === null || now - lastWrittenAt >= USAGE_REFRESH_MS) {
    return true
  }
  return lastMeasuredAt !== null && lastMeasuredAt > lastWrittenAt
}

// The real path, so a symlink or a case variant of the same folder compares equal; a folder not made yet resolves
// through its nearest existing parent.
function canonical(path: string): string {
  const full = resolve(path)
  try {
    return realpathSync.native(full)
  } catch {
    const parent = dirname(full)
    return parent === full ? full : join(canonical(parent), basename(full))
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The reporter as Pilot runs it: job 08's folder and the HTML page in Pilot's resources (none in orcad).
export function usageReporter(
  store: PilotStore,
  definitions: { current(): { definitions: { id: string; name: string }[] } },
  now: () => number,
  log: (message: string) => void,
  resourcesDir: string | undefined
): UsageReporter {
  const dir = pilotUsageReportDir()
  return createUsageReporter({
    store,
    automations: () => definitions.current().definitions,
    dir,
    templatePath: pilotUsageTemplate(process.env, resourcesDir ?? null),
    now,
    log
  })
}

export function createUsageReporter(deps: ReporterDeps): UsageReporter {
  let lastWrittenAt: number | null = null
  let dormantSaid = false

  function write(dir: string = deps.dir): UsageReportResult {
    const legacy = readLegacy(deps.dir)
    if (canonical(dir) === canonical(deps.dir) && legacy === null) {
      throw new Error(
        `Job 08 still owns ${deps.dir}: hand the report over first (README, "Spend and token usage"), or write elsewhere with --out <dir>`
      )
    }
    const now = deps.now()
    const report = buildUsageReport({
      buckets: deps.store.spend.reportBuckets(),
      sessionless: deps.store.spend.sessionlessSteps(),
      pending: deps.store.spend.pendingAgentSteps(),
      automations: deps.automations(),
      legacy,
      now
    })
    const files = writeReportFiles(dir, report, deps.templatePath)
    const note = renderUsageNote(report, dir, new Date(now), localIsoMinute(now).replace('T', ' '))
    files.push(writeUsageNote(dir, note, now))
    return {
      dir,
      rows: report.rows.length,
      sessions: new Set(report.rows.map((r) => r.session)).size,
      costUsd: report.rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0),
      files
    }
  }

  return {
    write,
    // Called after every poll. Never throws: a failed write is logged and tried again at the next change or hour.
    refreshIfDue() {
      if (!existsSync(join(deps.dir, LEGACY_FILE))) {
        if (!dormantSaid) {
          deps.log(
            `[pilot] usage report: waiting for the hand-over from job 08 (${join(deps.dir, LEGACY_FILE)} doesn't exist yet)`
          )
          dormantSaid = true
        }
        return
      }
      if (!isReportDue(lastWrittenAt, deps.store.usage.lastMeasuredAt(), deps.now())) {
        return
      }
      try {
        write(deps.dir)
      } catch (error) {
        deps.log(`[pilot] usage report failed: ${messageOf(error)}`)
      }
      lastWrittenAt = deps.now()
    }
  }
}
