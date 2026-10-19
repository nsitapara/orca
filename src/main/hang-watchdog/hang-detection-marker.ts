import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

// Why: written by the watchdog worker when main-thread heartbeats stop, refreshed while they stay
// stopped, and rewritten if they resume; consumed on the next launch to report how long the stall
// lasted and whether it ever cleared. `selfRecovered` separates a real deadlock from a
// long-but-survivable stall — the two are indistinguishable at detection time, and only the latter
// would have been a destructive kill.
export type HangDetectionMarker = {
  detectedAt: number
  parentPid: number
  unresponsiveMs: number
  selfRecovered: boolean
  /** `/usr/bin/sample` output taken when the hang was detected. */
  samplePath?: string
  /** `/usr/bin/sample` output taken earlier in the same stall, before it counted as a hang. */
  stallSamplePath?: string
}

// Unreadable: the file existed but held no valid marker, which a cut-short write leaves behind.
export type ConsumedHangDetectionMarker = HangDetectionMarker | 'unreadable' | null

export function hangDetectionMarkerPath(userDataPath: string): string {
  return join(userDataPath, 'main-thread-hang.json')
}

// Why names, not paths: breadcrumbs redact every path; the files sit beside the trace in logs/.
export function sampleFileBreadcrumbFields(
  paths: Pick<HangDetectionMarker, 'samplePath' | 'stallSamplePath'>
): { sampleFile?: string; stallSampleFile?: string } {
  const written = (path: string | undefined): string | undefined =>
    path && existsSync(path) ? basename(path) : undefined
  const sampleFile = written(paths.samplePath)
  const stallSampleFile = written(paths.stallSamplePath)
  return {
    ...(sampleFile ? { sampleFile } : {}),
    ...(stallSampleFile ? { stallSampleFile } : {})
  }
}

export function writeHangDetectionMarker(markerPath: string, marker: HangDetectionMarker): void {
  // Why rename: an in-place rewrite truncates first, so a write that fails or never finishes
  // would leave an empty file and lose the observation it was replacing.
  const tempPath = `${markerPath}.tmp`
  writeFileSync(tempPath, JSON.stringify(marker), { mode: 0o600 })
  renameSync(tempPath, markerPath)
}

function readAvailableHangDetectionMarker(
  markerPath: string
): HangDetectionMarker | 'unreadable' | undefined {
  let raw: string
  try {
    if (statSync(markerPath).size > 64 * 1024) {
      return 'unreadable'
    }
    raw = readFileSync(markerPath, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      !parsed ||
      !('detectedAt' in parsed) ||
      typeof parsed.detectedAt !== 'number' ||
      !Number.isFinite(parsed.detectedAt) ||
      !('parentPid' in parsed) ||
      typeof parsed.parentPid !== 'number' ||
      !Number.isInteger(parsed.parentPid) ||
      parsed.parentPid <= 0 ||
      !('unresponsiveMs' in parsed) ||
      typeof parsed.unresponsiveMs !== 'number' ||
      !Number.isFinite(parsed.unresponsiveMs) ||
      parsed.unresponsiveMs < 0
    ) {
      return 'unreadable'
    }
    const samplePath =
      'samplePath' in parsed && typeof parsed.samplePath === 'string' ? parsed.samplePath : ''
    const stallSamplePath =
      'stallSamplePath' in parsed && typeof parsed.stallSamplePath === 'string'
        ? parsed.stallSamplePath
        : ''
    return {
      detectedAt: parsed.detectedAt,
      parentPid: parsed.parentPid,
      unresponsiveMs: parsed.unresponsiveMs,
      // Why: a marker left by the detect leg and never rewritten means the stall never cleared.
      selfRecovered: 'selfRecovered' in parsed && parsed.selfRecovered === true,
      ...(samplePath ? { samplePath } : {}),
      ...(stallSamplePath ? { stallSamplePath } : {})
    }
  } catch {
    return 'unreadable'
  }
}

export function consumeHangDetectionMarker(markerPath: string): ConsumedHangDetectionMarker {
  const marker = readAvailableHangDetectionMarker(markerPath)
  // Retry unavailable reads next startup; only successfully inspected files are consumable.
  if (marker === undefined) {
    return null
  }
  try {
    rmSync(markerPath, { force: true })
  } catch {
    // A marker that cannot be deleted may produce a duplicate breadcrumb, but cannot block startup.
  }
  return marker
}
