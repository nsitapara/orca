import { afterEach, describe, expect, it, vi } from 'vitest'
import { setActiveSink } from '../../../../../main/observability/tracer'
import { StartupPhases, traceStartupMark, type StartupMark } from './pilot-startup'

function phases(): {
  startup: StartupPhases
  marks: StartupMark[]
  watchdog: {
    begin: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  tick: (ms: number) => void
} {
  let now = 0
  const marks: StartupMark[] = []
  const watchdog = { begin: vi.fn(), end: vi.fn(), stop: vi.fn() }
  const startup = new StartupPhases({
    expected: ['services', 'tray'],
    now: () => now,
    mark: (mark) => marks.push(mark),
    watchdog
  })
  return { startup, marks, watchdog, tick: (ms) => (now += ms) }
}

describe('StartupPhases', () => {
  it('marks each phase once, and completes when every expected phase has ended or failed', () => {
    const { startup, marks, watchdog, tick } = phases()
    startup.begin('services')
    startup.begin('services')
    tick(5)
    startup.end('services')
    startup.end('services')
    startup.begin('tray')
    tick(7)
    startup.fail('tray', new Error('database is locked'))
    startup.begin('window')
    expect(marks).toEqual([
      { event: 'begin', phase: 'services' },
      { event: 'end', phase: 'services', phaseMs: 5 },
      { event: 'begin', phase: 'tray' },
      { event: 'failed', phase: 'tray', phaseMs: 7, error: 'database is locked' },
      { event: 'complete', phaseMs: 12 }
    ])
    expect(watchdog.begin.mock.calls).toEqual([
      ['services', 0],
      ['tray', 5]
    ])
    expect(watchdog.end.mock.calls).toEqual([['services'], ['tray']])
    expect(watchdog.stop).toHaveBeenCalledTimes(1)
  })

  it('run() returns the work’s result, or marks the phase failed and rethrows', () => {
    const { startup, marks } = phases()
    expect(startup.run('services', () => 42)).toBe(42)
    expect(() =>
      startup.run('tray', () => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(marks.map((mark) => mark.event)).toEqual(['begin', 'end', 'begin', 'failed', 'complete'])
  })
})

describe('traceStartupMark', () => {
  afterEach(() => setActiveSink(null))

  it('writes a pilot.startup span to the trace and flushes it at once', () => {
    const records: unknown[] = []
    const flush = vi.fn()
    setActiveSink({ push: (record) => records.push(record), flush, close: () => {} })
    traceStartupMark({ event: 'begin', phase: 'tray' })
    expect(flush).toHaveBeenCalledTimes(1)
    traceStartupMark({
      event: 'failed',
      phase: 'services',
      phaseMs: 5000,
      error: 'database is locked'
    })
    expect(records).toEqual([
      expect.objectContaining({
        type: 'effect-span',
        name: 'pilot.startup',
        attributes: { kind: 'pilot-startup', event: 'begin', phase: 'tray' },
        exit: { _tag: 'Success' }
      }),
      expect.objectContaining({
        attributes: expect.objectContaining({ event: 'failed', phase: 'services' }),
        exit: expect.objectContaining({
          _tag: 'Failure',
          cause: expect.stringContaining('startup failed in services: database is locked')
        })
      })
    ])
  })
})
