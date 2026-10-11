import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../../../../cli/args'
import type { HandlerContext } from '../../../../cli/dispatch'
import { RUN_HANDLERS, stepFromEnv } from './handlers-run'
import { PILOT_COMMAND_SPECS } from './specs'

// The real parse: positionals, repeated pairs and --payload exactly as the CLI reads them.
function contextFor(argv: string[], result: unknown) {
  const parsed = normalizeCommandPositionals(
    PILOT_COMMAND_SPECS,
    parseArgs(argv, undefined, PILOT_COMMAND_SPECS)
  )
  const call = vi.fn().mockResolvedValue({ result })
  const context = {
    flags: parsed.flags,
    client: { call },
    cwd: '/',
    json: false
  } as unknown as HandlerContext
  return { context, call, commandPath: parsed.commandPath }
}

function insideStep(): void {
  vi.stubEnv('PILOT_RUN_ID', 'run-1')
  vi.stubEnv('PILOT_STEP_IDX', '2')
}

beforeEach(() => vi.stubEnv('ORCA_TERMINAL_HANDLE', ''))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('stepFromEnv', () => {
  it.each([
    [
      { PILOT_RUN_ID: 'run-1', PILOT_STEP_IDX: '2' },
      { runId: 'run-1', stepIdx: 2 }
    ],
    [{ PILOT_RUN_ID: 'run-1' }, null],
    [{ PILOT_RUN_ID: 'run-1', PILOT_STEP_IDX: 'x' }, null],
    [{ PILOT_STEP_IDX: '0' }, null]
  ])('%j', (env, expected) => {
    if (expected) {
      expect(stepFromEnv(env)).toEqual(expected)
    } else {
      expect(() => stepFromEnv(env)).toThrow("Not inside a Pilot run's step")
    }
  })
})

describe('pilot run output', () => {
  it("sends every pair, JSON-coerced, for the env's step", async () => {
    insideStep()
    const { context, call, commandPath } = contextFor(
      ['run', 'output', 'changed=true', 'report=two words'],
      { runId: 'run-1', stepIdx: 2, outputs: {} }
    )
    expect(commandPath).toEqual(['run', 'output'])
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await RUN_HANDLERS['run output'](context)
    expect(call).toHaveBeenCalledWith('pilot.run.output', {
      runId: 'run-1',
      stepIdx: 2,
      outputs: { changed: true, report: 'two words' }
    })
  })

  it("sends the terminal's handle beside the env's step, which is only the fallback", async () => {
    insideStep()
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor(['run', 'output', 'changed=true'], {
      runId: 'run-1',
      stepIdx: 2,
      outputs: {}
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await RUN_HANDLERS['run output'](context)
    expect(call).toHaveBeenCalledWith('pilot.run.output', {
      terminal: 'term-A',
      runId: 'run-1',
      stepIdx: 2,
      outputs: { changed: true }
    })
  })

  it('works from the terminal handle alone', async () => {
    vi.stubEnv('PILOT_RUN_ID', '')
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor(['run', 'output', 'changed=true'], {
      runId: 'run-1',
      stepIdx: 2,
      outputs: {}
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await RUN_HANDLERS['run output'](context)
    expect(call).toHaveBeenCalledWith('pilot.run.output', {
      terminal: 'term-A',
      outputs: { changed: true }
    })
  })

  it('refuses a bad pair before calling Pilot', async () => {
    insideStep()
    const { context, call } = contextFor(['run', 'output', 'oops'], {})
    await expect(RUN_HANDLERS['run output'](context)).rejects.toThrow('"oops" isn\'t key=value')
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses outside a step, with no terminal', async () => {
    vi.stubEnv('PILOT_RUN_ID', '')
    const { context, call } = contextFor(['run', 'output', 'a=1'], {})
    await expect(RUN_HANDLERS['run output'](context)).rejects.toThrow(
      "Not inside a Pilot run's step"
    )
    expect(call).not.toHaveBeenCalled()
  })
})

describe('pilot run event', () => {
  it('sends its kind and payload', async () => {
    insideStep()
    const { context, call } = contextFor(
      ['run', 'event', 'pushed', '--payload', '{"sha":"abc1234"}'],
      { id: 7 }
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await RUN_HANDLERS['run event'](context)
    expect(call).toHaveBeenCalledWith('pilot.run.event', {
      runId: 'run-1',
      kind: 'pushed',
      payload: { sha: 'abc1234' }
    })
  })

  it('sends the terminal handle too', async () => {
    insideStep()
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor(['run', 'event', 'pushed'], { id: 7 })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await RUN_HANDLERS['run event'](context)
    expect(call).toHaveBeenCalledWith('pilot.run.event', {
      terminal: 'term-A',
      runId: 'run-1',
      kind: 'pushed'
    })
  })

  it("refuses a payload that isn't a JSON object", async () => {
    insideStep()
    const { context, call } = contextFor(['run', 'event', 'pushed', '--payload', '[1]'], {})
    await expect(RUN_HANDLERS['run event'](context)).rejects.toThrow(
      '--payload must be a JSON object'
    )
    expect(call).not.toHaveBeenCalled()
  })
})
