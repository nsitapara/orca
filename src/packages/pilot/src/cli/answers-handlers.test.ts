import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.restoreAllMocks())

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
