import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { EMPTY_PEOPLE } from '../../shared/people'
import { nextTickAfter } from '../../shared/schedule/cron'
import type * as Cron from '../../shared/schedule/cron'
import type { LoadedDefinitions } from '../definitions/loader'
import type { PassFetchCache } from '../sources/fetch-cache'
import {
  MAX_CONCURRENT_TICKS,
  MAX_TRIGGERS_PER_MINUTE,
  PilotScheduler,
  REPO_WAIT_MS,
  type SchedulerDeps
} from './scheduler'
import type { TickOptions, TickResult } from './tick-runner'

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

const OK = { tickId: 1, status: 'ok' as const, error: null, decisions: [], warnings: [] }
const HOUR = 60 * 60_000
const PASS = { passId: 'pass-1' } as unknown as PassFetchCache

function loadedOf(defs: ReturnType<typeof def>[]): LoadedDefinitions {
  return { definitions: defs, errors: [], people: EMPTY_PEOPLE, peopleError: null, missingDirs: [] }
}

function deps(
  defs: ReturnType<typeof def>[],
  now: number,
  last: number | null
): SchedulerDeps & { ran: string[]; logs: string[]; problems: string[] } {
  const ran: string[] = []
  const logs: string[] = []
  const problems: string[] = []
  const loaded = loadedOf(defs)
  return {
    ran,
    logs,
    problems,
    now: () => now,
    definitions: () => loaded,
    lastTickAt: () => last,
    poll: async () => {},
    reposListed: () => true,
    newPass: () => PASS,
    repoProblem: (d, message) => problems.push(`${d.id}: ${message}`),
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

  // A file that turned invalid is shown from its last valid version, never ticked (fail closed).
  it('never ticks an automation shown only from its last valid version, nor runs it by hand', async () => {
    const d = deps([def('ci', '10 * * * *'), def('ok', '10 * * * *')], at1012, null)
    const loaded = {
      ...loadedOf([def('ci', '10 * * * *'), def('ok', '10 * * * *')]),
      displayOnly: ['ci']
    }
    d.definitions = () => loaded
    const scheduler = new PilotScheduler(d)
    await scheduler.tickAll()
    expect(d.ran).toEqual(['ok'])
    for (const dryRun of [false, true]) {
      await expect(scheduler.tickNow('ci', { dryRun })).rejects.toThrow("/a/ci.yaml isn't valid")
    }
    expect(d.ran).toEqual(['ok'])
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
    expect(d.logs[0]).toBe('[pilot] step poll failed: probe broke')
    expect(d.logs.slice(1).sort()).toEqual([
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

  const withGrace = (d: ReturnType<typeof def>, missedRunGraceMs: number) => ({
    ...d,
    missedRunGraceMs
  })

  it.each([
    ['a daily 07:00 slot missed by 1.5 h runs once with a 12 h grace', 12 * HOUR, ['prune']],
    ['the same slot is not caught up with the default 1 h grace', HOUR, []]
  ])('%s', async (_name, grace, ran) => {
    const at0830 = Date.UTC(2026, 9, 11, 15, 30) // 08:30 PDT
    const yesterday0700 = Date.UTC(2026, 9, 10, 14, 0)
    const d = deps([withGrace(def('prune', '0 7 * * *'), grace)], at0830, yesterday0700)
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(ran)
  })

  it('runs a slot missed a week ago only when it is inside the grace', async () => {
    const weekAgo = at1012 - 7 * 24 * HOUR
    const d = deps([withGrace(def('ci', '10 * * * *'), 2 * HOUR)], at1012, weekAgo)
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['ci'])
    const s = new PilotScheduler(
      deps([def('ci', '10 * * * *')], at1012 + 30 * 60_000, at1012 - 2 * HOUR)
    )
    expect(s.isDue(withGrace(def('ci', '10 * * * *'), 10 * 60_000))).toBe(false)
  })

  it('ticks at most four automations at once, and every due one runs', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const d = deps(
      ids.map((id) => def(id, '10 * * * *')),
      at1012,
      null
    )
    let inFlight = 0
    let peak = 0
    d.runTick = async (x) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      d.ran.push(x.id)
      return OK
    }
    await new PilotScheduler(d).tickAll()
    expect(peak).toBe(MAX_CONCURRENT_TICKS)
    expect([...d.ran].sort()).toEqual(ids)
  })

  it('hands every tick of one pass the same pass, and the next pass a new one; a manual tick gets none', async () => {
    const d = deps([def('a', '10 * * * *'), def('b', '10 * * * *')], at1012, null)
    const passes: (string | undefined)[] = []
    d.runTick = async (_x, opts) => {
      passes.push(opts.pass?.passId)
      return OK
    }
    let n = 0
    d.newPass = () => {
      n += 1
      return { passId: `pass-${n}` } as unknown as PassFetchCache
    }
    const s = new PilotScheduler(d)
    await s.tickAll()
    await s.tickNow('a', { dryRun: true })
    expect(passes).toEqual(['pass-1', 'pass-1', undefined])
  })

  it('waits for the runtime to list the repo before the first pass, still polling, for at most 5 minutes', async () => {
    let now = at1012
    const d = deps([def('ci', '10 * * * *'), def('m', 'manual')], at1012, null)
    d.now = () => now
    const asked: string[][] = []
    d.reposListed = (repos) => {
      asked.push(repos)
      return false
    }
    d.poll = vi.fn(async () => {})
    const s = new PilotScheduler(d)
    await s.tickAll()
    await s.tickAll()
    expect(d.ran).toEqual([])
    expect(d.problems).toEqual([])
    expect(d.poll).toHaveBeenCalledTimes(2)
    expect(asked[0]).toEqual(['r'])
    expect(d.logs).toEqual(['[pilot] waiting for Orca to list r before the first tick'])
    now = at1012 + REPO_WAIT_MS
    await s.tickAll()
    // A4: still unlisted after the wait, so it is a definition problem, not a failed tick.
    expect(d.ran).toEqual([])
    expect(d.problems).toEqual([`ci: repo "r" isn't added to Pilot`])
  })

  it("waits for the login shell's PATH before its first poll or tick", async () => {
    let found!: () => void
    const d = deps([def('ci', '10 * * * *')], at1012, null)
    d.poll = vi.fn(async () => {})
    const s = new PilotScheduler(d)
    s.holdUntil(new Promise<void>((resolve) => (found = resolve)))
    const loop = s.tickAll()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(d.poll).not.toHaveBeenCalled()
    expect(d.ran).toEqual([])
    found()
    await loop
    expect(d.poll).toHaveBeenCalledTimes(1)
    expect(d.ran).toEqual(['ci'])
  })

  it("ticks the automations whose repo is listed and reports the one whose repo isn't", async () => {
    let now = at1012
    const d = deps(
      [def('ci', '10 * * * *'), { ...def('lost', '10 * * * *'), repo: 'nope' }],
      at1012,
      null
    )
    d.now = () => now
    d.reposListed = (repos) => repos.every((repo) => repo === 'r')
    const s = new PilotScheduler(d)
    now = at1012 + REPO_WAIT_MS
    await s.tickAll()
    expect(d.ran).toEqual(['ci'])
    expect(d.problems).toEqual([`lost: repo "nope" isn't added to Pilot`])
  })

  it('ticks as soon as the repo is listed; after the first pass an unlisted repo is reported, never waited for', async () => {
    let listed = false
    const d = deps([def('ci', '10 * * * *')], at1012, null)
    d.reposListed = () => listed
    const s = new PilotScheduler(d)
    await s.tickAll()
    expect(d.ran).toEqual([])
    listed = true
    await s.tickAll()
    expect(d.ran).toEqual(['ci'])
    listed = false
    d.lastTickAt = () => at1012
    d.now = () => at1012 + 60 * 60_000
    await s.tickAll()
    expect(d.ran).toEqual(['ci'])
    expect(d.problems).toEqual([`ci: repo "r" isn't added to Pilot`])
    expect(d.logs).toEqual(['[pilot] waiting for Orca to list r before the first tick'])
  })
})

describe('PilotScheduler.trigger: a feed’s run: now ticks the receiving stage', () => {
  const NOW = Date.UTC(2026, 9, 13, 18, 5)
  const CAUSE = { automationId: 'dev-e2e-fix', runId: 'run-1', stage: 1, ids: ['WEB-2123'] }
  // Triggered ticks run in the background: let them settle.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  function started(defs: ReturnType<typeof def>[], now = () => NOW) {
    const d = deps(defs, NOW, null)
    d.now = now
    const options: TickOptions[] = []
    d.runTick = vi.fn(async (x, opts) => {
      d.ran.push(x.id)
      options.push(opts)
      return OK
    })
    const s = new PilotScheduler(d)
    s.start()
    return { d, s, options }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks an enabled stage at once, as a real tick that carries the run that asked', async () => {
    for (const schedule of ['6,36 * * * *', 'manual']) {
      const { d, s, options } = started([def('start', schedule)])
      s.trigger('start', CAUSE)
      await settle()
      expect(d.ran).toEqual(['start'])
      expect(options).toEqual([{ dryRun: false, trigger: CAUSE }])
      s.stop()
    }
  })

  it('never ticks a disabled stage, one shown from its last valid version, or an unknown one; its ids wait', async () => {
    const { d, s } = started([def('off', '6,36 * * * *', false), def('broken', 'manual')])
    d.definitions = () => ({
      ...loadedOf([def('off', '6,36 * * * *', false), def('broken', 'manual')]),
      displayOnly: ['broken']
    })
    for (const id of ['off', 'broken', 'gone']) {
      s.trigger(id, CAUSE)
    }
    await settle()
    expect(d.ran).toEqual([])
    expect(d.logs.filter((l) => l.includes('not triggered'))).toEqual([
      expect.stringContaining(
        '[pilot] off: not triggered by dev-e2e-fix run run-1: it is turned off; its handed-over ids wait'
      ),
      expect.stringContaining(
        "broken: not triggered by dev-e2e-fix run run-1: its file isn't valid"
      ),
      expect.stringContaining('gone: not triggered by dev-e2e-fix run run-1: no such automation')
    ])
    s.stop()
  })

  it('ticks once more after a tick of the stage that was running ends, however many triggers came meanwhile', async () => {
    const { d, s, options } = started([def('start', 'manual')])
    let release: () => void = () => {}
    d.runTick = vi.fn((x, opts) => {
      d.ran.push(x.id)
      options.push(opts)
      if (d.ran.length > 1) {
        return Promise.resolve(OK)
      }
      return new Promise<TickResult>((resolve) => (release = () => resolve(OK)))
    })
    const scheduled = s.tickNow('start', { dryRun: false })
    s.trigger('start', CAUSE)
    s.trigger('start', { ...CAUSE, runId: 'run-2' })
    expect(d.ran).toEqual(['start'])
    release()
    await scheduled
    await settle()
    expect(d.ran).toEqual(['start', 'start'])
    expect(options[1]).toEqual({ dryRun: false, trigger: { ...CAUSE, runId: 'run-2' } })
    s.stop()
  })

  it(`ticks a stage at most ${MAX_TRIGGERS_PER_MINUTE} times a minute from triggers; past that its ids wait for its schedule`, async () => {
    let now = NOW
    const { d, s } = started([def('start', 'manual')], () => now)
    for (let i = 0; i <= MAX_TRIGGERS_PER_MINUTE; i++) {
      s.trigger('start', { ...CAUSE, runId: `run-${i}` })
      await settle()
    }
    expect(d.ran).toHaveLength(MAX_TRIGGERS_PER_MINUTE)
    expect(d.logs.at(-1)).toContain(
      `start: not triggered by dev-e2e-fix run run-${MAX_TRIGGERS_PER_MINUTE}: it was triggered ${MAX_TRIGGERS_PER_MINUTE} times in the last minute`
    )
    now += 60_001
    s.trigger('start', CAUSE)
    await settle()
    expect(d.ran).toHaveLength(MAX_TRIGGERS_PER_MINUTE + 1)
    s.stop()
  })

  it('triggers nothing in a process whose scheduler never started, or after it stops', async () => {
    const d = deps([def('start', 'manual')], NOW, null)
    const s = new PilotScheduler(d)
    s.trigger('start', CAUSE)
    s.start()
    s.stop()
    s.trigger('start', CAUSE)
    await settle()
    expect(d.ran).toEqual([])
  })
})

describe('PilotScheduler run queue', () => {
  const at1012 = Date.UTC(2026, 9, 10, 19, 12) // 12:12 PDT

  it('ticks the automations with queued items first, in line order, though none is due', async () => {
    const d = deps(
      [def('ci', '10 * * * *'), def('review', '20 * * * *'), def('manual-job', 'manual')],
      at1012,
      Date.UTC(2026, 9, 10, 19, 10)
    )
    const asked: string[][] = []
    d.queuedToTick = (defs) => {
      asked.push(defs.map((x) => x.id))
      return ['manual-job', 'review']
    }
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['manual-job', 'review'])
    expect(asked).toEqual([['ci', 'review', 'manual-job']])
  })

  it('still ticks the due automations when the run queue cannot be read', async () => {
    const d = deps([def('ci', '10 * * * *')], at1012, Date.UTC(2026, 9, 10, 18, 10))
    d.queuedToTick = () => {
      throw new Error('database is locked')
    }
    await new PilotScheduler(d).tickAll()
    expect(d.ran).toEqual(['ci'])
    expect(d.logs).toContain("[pilot] couldn't read the run queue: database is locked")
  })
})
