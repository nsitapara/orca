import { closeSync, existsSync, mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startStartupWatchdog, type StartupWatchdog } from './startup-watchdog'

const LIMIT_MS = 200

// Atomics.wait parks this thread the way the 2026-10-13 deadlock parked the app's main thread:
// no timer, message or I/O callback of this thread runs until it returns.
function blockThisThread(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function records(path: string): unknown[] {
  if (!existsSync(path)) {
    return []
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

describe('startStartupWatchdog', () => {
  let dog: StartupWatchdog | null = null
  let errFd: number | null = null
  afterEach(() => {
    dog?.stop()
    dog = null
    if (errFd !== null) {
      closeSync(errFd)
      errFd = null
    }
  })

  function start(): { tracePath: string; errPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-startup-watchdog-'))
    const errPath = join(dir, 'stderr.txt')
    errFd = openSync(errPath, 'a')
    const tracePath = join(dir, 'main.trace.ndjson')
    dog = startStartupWatchdog({ tracePath, limitMs: LIMIT_MS, checkMs: 20, errorFd: errFd })
    return { tracePath, errPath }
  }

  // RED before the watchdog: the hung launch wrote nothing for 8 minutes after skill.recovery.
  it('writes "startup stuck in <phase>" to the trace and stderr while the main thread is blocked', () => {
    const { tracePath, errPath } = start()
    dog!.begin('tray', Date.now())
    blockThisThread(LIMIT_MS * 8)
    expect(records(tracePath)).toEqual([
      expect.objectContaining({
        type: 'effect-span',
        name: 'pilot.startup',
        attributes: expect.objectContaining({
          kind: 'pilot-startup',
          event: 'stuck',
          phase: 'tray'
        }),
        exit: expect.objectContaining({
          _tag: 'Failure',
          cause: expect.stringContaining('startup stuck in tray')
        })
      })
    ])
    expect(readFileSync(errPath, 'utf8')).toContain('[pilot] startup stuck in tray')
  })

  it('logs nothing for a phase that ends in time, or once it is stopped', async () => {
    const { tracePath, errPath } = start()
    dog!.begin('services', Date.now())
    dog!.end('services')
    dog!.begin('window', Date.now())
    dog!.stop()
    await new Promise((resolve) => setTimeout(resolve, LIMIT_MS * 4))
    expect(records(tracePath)).toEqual([])
    expect(readFileSync(errPath, 'utf8')).toBe('')
  })
})
