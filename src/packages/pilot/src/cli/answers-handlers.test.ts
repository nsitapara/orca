import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../../cli/dispatch'
import { ANSWERS_HANDLERS } from './answers-handlers'

function ctx(flags: Record<string, string>, call: unknown): HandlerContext {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call },
    cwd: '/',
    json: false
  } as HandlerContext
}

describe('inbox tick and reply', () => {
  // The reply names the run it comes from (the env's binding); none is set here.
  beforeEach(() => {
    for (const name of ['ORCA_TERMINAL_HANDLE', 'PILOT_RUN_ID', 'PILOT_STEP_IDX']) {
      vi.stubEnv(name, '')
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([
    ['inbox tick', { id: 'in_1', outcome: 'done: pushed' }, 'pilot.inbox.tick'],
    ['inbox reply', { id: 'in_1', text: 'Which one?' }, 'pilot.inbox.reply']
  ])('%s calls %s and prints the card', async (key, flags, method) => {
    const item = { id: 'in_1', status: 'done', outcome: 'done: pushed', title: 'Push?' }
    const call = vi.fn().mockResolvedValue({ result: item })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS[key](ctx(flags, call))
    expect(call).toHaveBeenCalledWith(method, flags)
    expect(log).toHaveBeenCalledWith('in_1 · done · done: pushed · Push?')
  })
})

describe('inbox reply names the run it comes from', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('sends the env binding with the reply', async () => {
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-9')
    vi.stubEnv('PILOT_RUN_ID', 'ans-1')
    vi.stubEnv('PILOT_STEP_IDX', '0')
    const call = vi.fn().mockResolvedValue({ result: { id: 'in_1', status: 'open', title: 't' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['inbox reply'](ctx({ id: 'in_1', text: 'Which one?' }, call))
    expect(call).toHaveBeenCalledWith('pilot.inbox.reply', {
      id: 'in_1',
      text: 'Which one?',
      terminal: 'term-9',
      runId: 'ans-1',
      stepIdx: 0
    })
  })
})

describe('action run', () => {
  const BOUND = ['PILOT_RUN_ID', 'PILOT_STEP_IDX', 'ORCA_TERMINAL_HANDLE'] as const
  const saved = Object.fromEntries(BOUND.map((k) => [k, process.env[k]]))
  beforeEach(() => BOUND.forEach((k) => delete process.env[k]))
  afterEach(() => {
    process.exitCode = 0
    vi.restoreAllMocks()
    for (const k of BOUND) {
      if (saved[k] === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = saved[k]
      }
    }
  })

  it.each([
    ['done', 0],
    ['stale', 3],
    ['asked', 6],
    ['something new', 1]
  ])('sends the caller binding and pinned args, and exits %s with %i', async (outcome, code) => {
    Object.assign(process.env, {
      PILOT_RUN_ID: 'run-1',
      PILOT_STEP_IDX: '2',
      ORCA_TERMINAL_HANDLE: 'term-1'
    })
    const call = vi.fn().mockResolvedValue({ result: { outcome, detail: 'x' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['action run'](
      ctx({ name: 'push', 'args-json': '{"argv":["/wt","b","aaa","bbb"]}' }, call)
    )
    expect(call).toHaveBeenCalledWith(
      'pilot.action.run',
      {
        action: 'push',
        args: { argv: ['/wt', 'b', 'aaa', 'bbb'] },
        dryRun: false,
        terminal: 'term-1',
        runId: 'run-1',
        stepIdx: 2
      },
      { timeoutMs: 660_000 }
    )
    expect(process.exitCode ?? 0).toBe(code)
  })

  it('sends no binding outside a Pilot run, and the run id alone when the step index is missing', async () => {
    const call = vi.fn().mockResolvedValue({ result: { outcome: 'done', detail: 'x' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['action run'](
      ctx({ name: 'push', 'args-json': '{}', 'dry-run': true } as never, call)
    )
    expect(call).toHaveBeenLastCalledWith(
      'pilot.action.run',
      { action: 'push', args: {}, dryRun: true },
      { timeoutMs: 660_000 }
    )
    process.env.PILOT_RUN_ID = 'run-1'
    await ANSWERS_HANDLERS['action run'](ctx({ name: 'push', 'args-json': '{}' }, call))
    expect(call).toHaveBeenLastCalledWith(
      'pilot.action.run',
      { action: 'push', args: {}, dryRun: false, runId: 'run-1' },
      { timeoutMs: 660_000 }
    )
  })

  it.each([['["a"]'], ['"a"'], ['not json']])(
    'refuses args that are not a JSON object: %s',
    async (raw) => {
      await expect(
        ANSWERS_HANDLERS['action run'](ctx({ name: 'push', 'args-json': raw }, vi.fn()))
      ).rejects.toThrow('--args-json must be a JSON object')
    }
  )

  it('lists the catalog, one action per line', async () => {
    const call = vi.fn().mockResolvedValue({
      result: [
        { name: 'push', power: 'push', usage: 'push { … }' },
        { name: 'start_run', power: null, usage: 'start_run { … }' }
      ]
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['action list'](ctx({}, call))
    expect(call).toHaveBeenCalledWith('pilot.action.list')
    expect(log).toHaveBeenCalledWith(
      'push              push           push { … }\nstart_run         approval       start_run { … }'
    )
  })
})

describe('inbox queue', () => {
  it('prints one line per queued answer with its hold reason', async () => {
    const entries = [
      {
        state: 'held',
        title: 'Push?',
        fires: 'Run push; no agent',
        holdReason: 'typing',
        holdDetail: 'someone is typing in Claude · CI fix'
      },
      {
        state: 'not_ready',
        title: 'Which?',
        fires: 'Mark it kept',
        holdReason: null,
        holdDetail: null
      }
    ]
    const call = vi.fn().mockResolvedValue({ result: { entries } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['inbox queue'](ctx({ person: 'nish' }, call))
    expect(call).toHaveBeenCalledWith('pilot.queue.list', { person: 'nish' })
    expect(log).toHaveBeenCalledWith(
      'held       Push? · Run push; no agent · someone is typing in Claude · CI fix\nnot ready  Which? · Mark it kept'
    )
  })
})

describe('inbox apply-now', () => {
  afterEach(() => vi.restoreAllMocks())

  it('asks for one card or all, with a long timeout, and prints the report', async () => {
    const report = { retired: 0, ticked: 1, actions: 0, agents: 1, held: 0, reasked: 0 }
    const call = vi.fn().mockResolvedValue({ result: report })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ANSWERS_HANDLERS['inbox apply-now'](ctx({ id: 'in_1' }, call))
    await ANSWERS_HANDLERS['inbox apply-now'](ctx({}, call))
    expect(call.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['pilot.answers.applyNow', { ids: ['in_1'] }, { timeoutMs: 660_000 }],
      ['pilot.answers.applyNow', {}, { timeoutMs: 660_000 }]
    ])
    expect(log).toHaveBeenCalledWith(
      'retired 0 · ticked 1 · actions 0 · agents 1 · held 0 · re-asked 0'
    )
  })
})
