import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { EMPTY_PEOPLE } from '../../shared/people'
import { nextTickAfter } from '../../shared/schedule/cron'
import type * as Cron from '../../shared/schedule/cron'
import type { LoadedDefinitions } from '../definitions/loader'
import { PilotScheduler, type SchedulerDeps } from './scheduler'
import type { TickResult } from './tick-runner'

vi.mock('../../shared/schedule/cron', async (importOriginal) => {
  const actual = await importOriginal<typeof Cron>()
  return { ...actual, nextTickAfter: vi.fn(actual.nextTickAfter) }
})

function def(id: string, schedule: string, enabled = true) {
  const r = parseAutomationYaml(
    `name: ${id}\nrepo: r\nschedule: "${schedule}"\nenabled: ${enabled}\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\n`,
    `/a/${id}.yaml`
  )
  if (!r.ok) {
    throw new Error(r.errors.join('\n'))
  }
  return r.definition
}

const OK = { tickId: 1, status: 'ok' as const, error: null, decisions: [] }

function loadedOf(defs: ReturnType<typeof def>[]): LoadedDefinitions {
  return { definitions: defs, errors: [], people: EMPTY_PEOPLE, peopleError: null, missingDirs: [] }
}

function deps(
  defs: ReturnType<typeof def>[],
  now: number,
  last: number | null
): SchedulerDeps & { ran: string[]; logs: string[] } {
  const ran: string[] = []
  const logs: string[] = []
  const loaded = loadedOf(defs)
  return {
    ran,
    logs,
    now: () => now,
    definitions: () => loaded,
    lastTickAt: () => last,
    poll: async () => {},
    log: (m) => logs.push(m),
    runTick: async (d) => {
      ran.push(d.id)
      return OK
    }
  }
}

describe('PilotScheduler', () => {
  const at1012 = Date.UTC(2026, 9, 10, 19, 12) // 12:12 PDT

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks an hourly :10 automation whose last tick was before 12:10', async () => {
    const d = deps([def('ci', '10 * * * *')], at1012, Date.UTC(2026, 9, 10, 18, 10))
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['ci'])
  })

  it('does not tick again within the same hour', async () => {
    const d = deps([def('ci', '10 * * * *')], at1012, Date.UTC(2026, 9, 10, 19, 10))
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual([])
  })

  it('never auto-ticks manual or disabled automations', async () => {
    const d = deps([def('m', 'manual'), def('off', '10 * * * *', false)], at1012, null)
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual([])
  })

  it('runs a missed hour once, not once per missed tick', async () => {
    const d = deps([def('ci', '10 * * * *')], at1012, Date.UTC(2026, 9, 10, 10, 10))
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['ci'])
  })

  it('refuses a second tick of the same automation while one runs (Review Focus 5)', async () => {
    let release: () => void = () => {}
    const d = deps([def('ci', 'manual')], at1012, null)
    d.runTick = vi.fn(() => new Promise<TickResult>((resolve) => (release = () => resolve(OK))))
    const s = new PilotScheduler(d)
    const first = s.tickNow('ci', { dryRun: false })
    expect(await s.tickNow('ci', { dryRun: true })).toEqual({ status: 'busy' })
    release()
    await first
    expect(d.runTick).toHaveBeenCalledTimes(1)
    expect(await s.tickNow('nope', { dryRun: false })).toEqual({ status: 'unknown' })
  })

  it('keeps ticking the others and still polls when one automation throws (T18→T20)', async () => {
    const d = deps([def('a', '10 * * * *'), def('b', '10 * * * *')], at1012, null)
    d.runTick = vi.fn(async (x) => {
      if (x.id === 'a') {
        throw new Error('database is locked')
      }
      d.ran.push(x.id)
      return OK
    })
    d.poll = vi.fn(async () => {})
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['b'])
    expect(d.poll).toHaveBeenCalledTimes(1)
    expect(d.logs).toEqual(['[pilot] a tick failed: database is locked'])
  })

  it('logs a failed tick, a throwing schedule read and a failed poll, and never rejects', async () => {
    const d = deps([def('a', '10 * * * *'), def('b', '10 * * * *')], at1012, null)
    d.runTick = async () => ({ ...OK, status: 'failed', error: 'glab: 401' })
    d.lastTickAt = (id) => {
      if (id === 'b') {
        throw new Error('store closed')
      }
      return null
    }
    d.poll = async () => {
      throw new Error('probe broke')
    }
    await expect(new PilotScheduler(d).tickAll()).resolves.toBeUndefined()
    expect(d.logs).toEqual([
      '[pilot] step poll failed: probe broke',
      '[pilot] a tick failed: glab: 401',
      '[pilot] b tick failed: store closed'
    ])
  })

  it('walks the cron once until the automation really ticks or its schedule changes (T12)', async () => {
    const walk = vi.mocked(nextTickAfter)
    let last = Date.UTC(2026, 9, 10, 19, 10)
    const d = deps([def('ci', 'manual')], at1012, null)
    d.lastTickAt = () => last
    const s = new PilotScheduler(d)
    walk.mockClear()
    expect(s.isDue(def('ci', '10 * * * *'))).toBe(false)
    expect(s.isDue(def('ci', '10 * * * *'))).toBe(false)
    expect(s.nextTickAt(def('ci', '10 * * * *'))).toBe(Date.UTC(2026, 9, 10, 20, 10))
    expect(walk).toHaveBeenCalledTimes(1)
    expect(s.isDue(def('ci', '5 * * * *'))).toBe(false)
    expect(walk).toHaveBeenCalledTimes(2)
    await s.tickNow('ci', { dryRun: true })
    s.isDue(def('ci', '5 * * * *'))
    expect(walk).toHaveBeenCalledTimes(2)
    last = Date.UTC(2026, 9, 10, 20, 5)
    await s.tickNow('ci', { dryRun: false })
    expect(s.nextTickAt(def('ci', '5 * * * *'))).toBe(Date.UTC(2026, 9, 10, 21, 5))
    expect(walk).toHaveBeenCalledTimes(3)
  })

  it('waits 60s, then checks every 15s with a step poll each time, until stopped', async () => {
    vi.useFakeTimers()
    const d = deps([], at1012, null)
    d.poll = vi.fn(async () => {})
    const s = new PilotScheduler(d)
    s.start()
    expect(d.logs).toEqual(['[pilot] scheduler started: first check in 60s, then every 15s'])
    await vi.advanceTimersByTimeAsync(59_999)
    expect(d.poll).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(d.poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(d.poll).toHaveBeenCalledTimes(3)
    s.stop()
    s.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(d.poll).toHaveBeenCalledTimes(3)
  })

  it('does not start a second loop while one is still running', async () => {
    let release: () => void = () => {}
    const d = deps([def('ci', '10 * * * *')], at1012, null)
    d.runTick = vi.fn(() => new Promise<TickResult>((resolve) => (release = () => resolve(OK))))
    d.poll = vi.fn(async () => {})
    const s = new PilotScheduler(d)
    expect(s.loopTimes()).toEqual({ loopStartedAt: null, lastLoopFinishedAt: null })
    const first = s.tickAll()
    const second = s.tickAll()
    await vi.waitFor(() => expect(d.runTick).toHaveBeenCalled())
    expect(s.loopTimes()).toEqual({ loopStartedAt: at1012, lastLoopFinishedAt: null })
    release()
    await Promise.all([first, second])
    expect(d.runTick).toHaveBeenCalledTimes(1)
    expect(d.poll).toHaveBeenCalledTimes(1)
    expect(s.loopTimes()).toEqual({ loopStartedAt: null, lastLoopFinishedAt: at1012 })
  })

  it('catches up a missed slot only for automations there at the first loop; later edits wait (05 cutover)', async () => {
    const d = deps(
      [def('ci', '10 * * * *'), def('cutover', 'manual'), def('off', '10 * * * *', false)],
      at1012,
      null
    )
    const s = new PilotScheduler(d)
    await s.tickAll()
    expect(d.ran).toEqual(['ci'])
    // A real manual run during the shadow period, a day before the cutover.
    await s.tickNow('cutover', { dryRun: false })
    d.lastTickAt = (id) => {
      if (id === 'ci') {
        return at1012
      }
      return id === 'cutover' ? Date.UTC(2026, 9, 9, 19, 10) : null
    }
    const edited = [
      def('ci', '10 * * * *'),
      def('cutover', '10 * * * *'),
      def('off', '10 * * * *'),
      def('added', '10 * * * *')
    ]
    d.definitions = () => loadedOf(edited)
    await s.tickAll()
    expect(d.ran).toEqual(['ci', 'cutover'])
    const at1310 = Date.UTC(2026, 9, 10, 20, 10)
    expect(edited.map((x) => s.nextTickAt(x))).toEqual([at1310, at1310, at1310, at1310])
  })
})
