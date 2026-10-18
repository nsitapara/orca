import { describe, expect, it, vi } from 'vitest'
import type { PilotcliReply } from '../envs/pilotcli'
import { projectIn, rememberedProjectOf } from './create'

const reply = (outcome: PilotcliReply['outcome'], data: unknown): PilotcliReply => ({
  outcome,
  reason: '',
  data,
  code: 0
})

describe('projectIn', () => {
  it.each([
    [
      'a project',
      reply('ok', { worktree: { project: 'web-platform', dir: '/r/web' } }),
      'web-platform'
    ],
    [
      'a repo pilotcli does not know',
      reply('ok', { worktree: null, worktree_error: 'no origin remote' }),
      null
    ],
    ['a failed call', reply('failed', null), null],
    ['a project that is not a name', reply('ok', { worktree: { project: 3 } }), null]
  ])('%s', (_name, given, want) => {
    expect(projectIn(given)).toBe(want)
  })
})

describe('rememberedProjectOf', () => {
  it('asks pilotcli at most once a minute per repo', async () => {
    let now = 0
    const ask = vi.fn(async (repo: string) => (repo === '/r/web' ? 'web-platform' : null))
    const projectOf = rememberedProjectOf(ask, () => now)
    expect(await projectOf('/r/web')).toBe('web-platform')
    now = 59_999
    await projectOf('/r/web')
    expect(await projectOf('/r/other')).toBeNull()
    expect(ask.mock.calls.map(([repo]) => repo)).toEqual(['/r/web', '/r/other'])
    now = 60_000
    await projectOf('/r/web')
    expect(ask).toHaveBeenCalledTimes(3)
  })
})
