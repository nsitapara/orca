import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../../cli/dispatch'
import { AUTOMATION_FILE_HANDLERS } from './handlers-automations'

const LIST = {
  automations: [],
  errors: [],
  peopleError: null,
  missingDirs: []
}

function contextFor(flags: Record<string, string>, result: unknown) {
  const call = vi.fn().mockResolvedValue({ result })
  const context = {
    flags: new Map(Object.entries(flags)),
    client: { call },
    cwd: '/',
    json: false
  } as unknown as HandlerContext
  return { context, call }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("Pilot's automation file commands", () => {
  it.each([
    ['automations list-yaml', {}, 'pilot.automations.list', undefined, LIST],
    ['automations reload', {}, 'pilot.automations.reload', undefined, LIST],
    [
      'automations show-yaml',
      { id: 'fix-ci' },
      'pilot.automations.get',
      { id: 'fix-ci' },
      {
        summary: {
          id: 'fix-ci',
          name: 'x',
          file: '/f',
          enabled: true,
          schedule: 'manual',
          timezone: 'UTC',
          nextTickAt: null
        },
        yaml: '',
        checkNames: []
      }
    ],
    [
      'automations enable',
      { id: 'fix-ci' },
      'pilot.automations.setEnabled',
      { id: 'fix-ci', enabled: true },
      { id: 'fix-ci', enabled: true }
    ],
    [
      'automations disable',
      { id: 'fix-ci' },
      'pilot.automations.setEnabled',
      { id: 'fix-ci', enabled: false },
      { id: 'fix-ci', enabled: false }
    ]
  ])('%s', async (key, flags, method, params, result) => {
    vi.stubEnv('ORCA_TERMINAL_HANDLE', '')
    vi.stubEnv('PILOT_RUN_ID', '')
    const { context, call } = contextFor(flags, result)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await AUTOMATION_FILE_HANDLERS[key](context)
    if (params === undefined) {
      expect(call).toHaveBeenCalledWith(method)
    } else {
      expect(call).toHaveBeenCalledWith(method, params)
    }
  })

  // The server refuses enable/disable from an agent in a run; the CLI says where it is called from.
  it.each([
    ['automations enable', true],
    ['automations disable', false]
  ])('%s sends the terminal and run it is called from', async (key, enabled) => {
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-1')
    vi.stubEnv('PILOT_RUN_ID', 'run-1')
    vi.stubEnv('PILOT_STEP_IDX', '2')
    const { context, call } = contextFor({ id: 'fix-ci' }, { id: 'fix-ci', enabled })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await AUTOMATION_FILE_HANDLERS[key](context)
    expect(call).toHaveBeenCalledWith('pilot.automations.setEnabled', {
      id: 'fix-ci',
      enabled,
      terminal: 'term-1',
      runId: 'run-1',
      stepIdx: 2
    })
  })
})
