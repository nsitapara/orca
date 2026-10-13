import { getTraceFilePath } from '../../../../../main/observability/logs-directory'
import {
  flushActiveSink,
  hasActiveTraceSink,
  startSpan
} from '../../../../../main/observability/tracer'
import type { PilotHostKind } from '../env'
import { startStartupWatchdog, type StartupWatchdog } from './startup-watchdog'

// The main process's startup, in order. `services` is attachPilotMain (store open and migrate);
// `launch` runs from there to the main window; the window hook (tray-after-launch) owns the rest.
const DESKTOP_PHASES = ['services', 'launch', 'window', 'renderer', 'tray']
// serve opens no window.
const SERVE_PHASES = ['services']

export type StartupMark =
  | { event: 'begin'; phase: string }
  | { event: 'end'; phase: string; phaseMs: number }
  | { event: 'failed'; phase: string; phaseMs: number; error: string }
  | { event: 'complete'; phaseMs: number }

export type StartupPhasesDeps = {
  expected: readonly string[]
  now: () => number
  mark: (mark: StartupMark) => void
  watchdog: StartupWatchdog | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Each phase begins and ends once; the first window's events end them, and once every expected
// phase has ended (or failed) the startup is complete and further calls do nothing.
export class StartupPhases {
  private readonly open = new Map<string, number>()
  private readonly ended = new Set<string>()
  private readonly startedAt: number
  private finished = false

  constructor(private readonly deps: StartupPhasesDeps) {
    this.startedAt = deps.now()
  }

  begin(phase: string): void {
    if (this.finished || this.open.has(phase) || this.ended.has(phase)) {
      return
    }
    const at = this.deps.now()
    this.open.set(phase, at)
    this.deps.mark({ event: 'begin', phase })
    this.deps.watchdog?.begin(phase, at)
  }

  end(phase: string): void {
    this.close(phase, null)
  }

  fail(phase: string, error: unknown): void {
    this.close(phase, messageOf(error))
  }

  run<T>(phase: string, work: () => T): T {
    this.begin(phase)
    try {
      const result = work()
      this.end(phase)
      return result
    } catch (error) {
      this.fail(phase, error)
      throw error
    }
  }

  private close(phase: string, error: string | null): void {
    const startedAt = this.open.get(phase)
    if (startedAt === undefined) {
      return
    }
    this.open.delete(phase)
    this.ended.add(phase)
    this.deps.watchdog?.end(phase)
    const phaseMs = this.deps.now() - startedAt
    if (error === null) {
      this.deps.mark({ event: 'end', phase, phaseMs })
    } else {
      this.deps.mark({ event: 'failed', phase, phaseMs, error })
    }
    if (this.deps.expected.every((p) => this.ended.has(p))) {
      this.finished = true
      this.deps.mark({ event: 'complete', phaseMs: this.deps.now() - this.startedAt })
      this.deps.watchdog?.stop()
    }
  }
}

export function traceStartupMark(mark: StartupMark): void {
  const span = startSpan('pilot.startup', { attributes: { kind: 'pilot-startup', ...mark } })
  if (mark.event === 'failed') {
    span.fail(`startup failed in ${mark.phase}: ${mark.error}`)
  } else {
    span.end()
  }
  // Why: a marker left in the trace's 200ms batch is lost if the main thread hangs right after it.
  flushActiveSink()
}

let current: StartupPhases | null = null

export function pilotStartup(): StartupPhases | null {
  return current
}

function startWatchdog(): StartupWatchdog | null {
  try {
    return startStartupWatchdog({ tracePath: hasActiveTraceSink() ? getTraceFilePath() : null })
  } catch (error) {
    console.error(`[pilot] couldn't start the startup watchdog: ${messageOf(error)}`)
    return null
  }
}

// Called once by attachPilotMain. Like upstream's hang watchdog, only packaged builds are watched:
// a dev main thread paused in a debugger isn't stuck.
export function beginPilotStartup(kind: PilotHostKind, packaged: boolean): StartupPhases {
  current = new StartupPhases({
    expected: kind === 'serve' ? SERVE_PHASES : DESKTOP_PHASES,
    now: () => Date.now(),
    mark: traceStartupMark,
    watchdog: packaged ? startWatchdog() : null
  })
  return current
}
