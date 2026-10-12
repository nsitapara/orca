import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../../cli/dispatch'
import { IMPORT_HANDLERS } from './handlers-import'

function ctx(flags: Record<string, string | boolean>, call: unknown): HandlerContext {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call },
    cwd: '/',
    json: true
  } as HandlerContext
}

const NONE = { total: 0, present: 0, added: 0 }
const RESULT = {
  automationId: 'a',
  apply: false,
  plan: { automationId: 'a', handled: [], sessions: [], files: [], notes: [] },
  handled: NONE,
  seen: NONE,
  sessions: NONE,
  dispatched: NONE,
  files: NONE
}

describe('automations import-state', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [{ id: 'a' }, false],
    [{ id: 'a', apply: true }, true]
  ])('%o asks Pilot to import with apply=%s', async (flags, apply) => {
    const call = vi.fn().mockResolvedValue({ result: RESULT })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await IMPORT_HANDLERS['automations import-state'](ctx(flags, call))
    expect(call).toHaveBeenCalledWith('pilot.automations.importState', { id: 'a', apply })
  })

  it('refuses --apply with a value', async () => {
    await expect(
      IMPORT_HANDLERS['automations import-state'](ctx({ id: 'a', apply: 'yes' }, vi.fn()))
    ).rejects.toThrow('--apply takes no value')
  })
})
