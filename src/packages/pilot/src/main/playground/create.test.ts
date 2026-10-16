import { describe, expect, it } from 'vitest'
import type { PilotcliReply } from '../envs/pilotcli'
import { projectIn } from './create'

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
