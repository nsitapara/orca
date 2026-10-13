import { Worker } from 'node:worker_threads'

// A startup phase still open after this long is reported as stuck.
export const STARTUP_PHASE_LIMIT_MS = 30_000
const CHECK_MS = 1_000

export type StartupWatchdogOptions = {
  // Upstream's main.trace.ndjson; null when local tracing is off (stderr still gets the line).
  tracePath: string | null
  limitMs?: number
  checkMs?: number
  errorFd?: number
}

export type StartupWatchdog = {
  begin(phase: string, at: number): void
  end(phase: string): void
  stop(): void
}

// Why a worker: a main thread deadlocked in AppKit runs no timer and flushes no trace batch, so only
// another thread can notice and write. Why eval'd source: it needs no extra build entry or asar path.
// It writes the trace line itself, in the shape of upstream's effect-span records.
const WORKER_SOURCE = String.raw`
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const { appendFileSync, writeSync } = require('node:fs')
const { randomBytes } = require('node:crypto')
const { tracePath, limitMs, checkMs, errorFd } = workerData
const open = new Map()
const reported = new Set()

function report(phase, startedAt, now) {
  const stuckForMs = now - startedAt
  const message = 'startup stuck in ' + phase + ' for ' + Math.round(stuckForMs / 1000) + 's'
  if (tracePath) {
    const record = {
      type: 'effect-span',
      name: 'pilot.startup',
      traceId: randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      kind: 'internal',
      startTimeUnixNano: String(startedAt) + '000000',
      endTimeUnixNano: String(now) + '000000',
      durationMs: stuckForMs,
      attributes: { kind: 'pilot-startup', event: 'stuck', phase: phase, phaseMs: stuckForMs },
      events: [],
      exit: { _tag: 'Failure', cause: message + '; the main process may be hung' }
    }
    try {
      appendFileSync(tracePath, JSON.stringify(record) + '\n')
    } catch {}
  }
  try {
    writeSync(errorFd, '[pilot] ' + message + '; the main process may be hung\n')
  } catch {}
}

const timer = setInterval(() => {
  const now = Date.now()
  for (const [phase, startedAt] of open) {
    if (!reported.has(phase) && now - startedAt >= limitMs) {
      reported.add(phase)
      report(phase, startedAt, now)
    }
  }
}, checkMs)

parentPort.on('message', (message) => {
  if (message.type === 'begin' && !open.has(message.phase)) {
    open.set(message.phase, message.at)
  }
  if (message.type === 'end') {
    open.delete(message.phase)
  }
  if (message.type === 'stop') {
    clearInterval(timer)
    parentPort.close()
  }
})
`

export function startStartupWatchdog(options: StartupWatchdogOptions): StartupWatchdog {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    name: 'pilot-startup-watchdog',
    workerData: {
      tracePath: options.tracePath,
      limitMs: options.limitMs ?? STARTUP_PHASE_LIMIT_MS,
      checkMs: options.checkMs ?? CHECK_MS,
      errorFd: options.errorFd ?? 2
    }
  })
  // Never keeps the app alive; its own interval keeps it running while the main thread is stuck.
  worker.unref()
  worker.on('error', (error) => console.error('[pilot] startup watchdog failed:', error))
  let stopped = false
  const post = (message: Record<string, unknown>): void => {
    if (stopped) {
      return
    }
    try {
      worker.postMessage(message)
    } catch {
      // The worker already exited.
    }
  }
  return {
    begin: (phase, at) => post({ type: 'begin', phase, at }),
    end: (phase) => post({ type: 'end', phase }),
    stop: () => {
      post({ type: 'stop' })
      stopped = true
    }
  }
}
