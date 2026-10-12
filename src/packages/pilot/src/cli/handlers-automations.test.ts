import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../../cli/dispatch'
import { AUTOMATION_FILE_HANDLERS } from './handlers-automations'

const LIST = { automations: [], errors: [], peopleError: null, missingDirs: [] }

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

afterEach(() => vi.restoreAllMocks())

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
    const { context, call } = contextFor(flags, result)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await AUTOMATION_FILE_HANDLERS[key](context)
    if (params === undefined) {
      expect(call).toHaveBeenCalledWith(method)
    } else {
      expect(call).toHaveBeenCalledWith(method, params)
    }
  })
})
