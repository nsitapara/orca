import { describe, expect, it, vi } from 'vitest'
import type { PilotcliCall, PilotcliReply } from '../envs/pilotcli'
import { readSourceIndex, sourceIndexReader } from './source-index'

const ok = (data: unknown): PilotcliReply => ({ outcome: 'ok', reason: '', data, code: 0 })
const VERSION = ok({ version: 'd91a242', go: 'go1.27', source_root: '/src/pilotCLI' })
const COMMANDS = ok({
  modules: [
    {
      name: 'git',
      commands: [
        {
          command: 'git push-branch',
          source: { file: 'internal/modules/git/push_branch.go', line: 84 }
        },
        { command: 'git get-branch' }
      ]
    }
  ]
})

// Answers get-version and list-commands by the call's second word.
function pilotcli(version: PilotcliReply, commands: PilotcliReply) {
  return async (call: PilotcliCall): Promise<PilotcliReply> =>
    call.args[1] === 'get-version' ? version : commands
}

describe('readSourceIndex', () => {
  it.each([
    [
      'pilotcli says where it was built',
      VERSION,
      COMMANDS,
      {
        root: '/src/pilotCLI',
        commands: { 'git push-branch': { file: 'internal/modules/git/push_branch.go', line: 84 } }
      }
    ],
    [
      'a pilotcli from before source_root',
      ok({ version: 'be3f040', go: 'go1.27' }),
      COMMANDS,
      null
    ],
    [
      'a failed list',
      VERSION,
      { outcome: 'failed', reason: 'x', data: null, code: 1 } as const,
      null
    ]
  ])('%s', async (_name, version, commands, want) => {
    expect(await readSourceIndex(pilotcli(version, commands), '/home/.agents/skills')).toEqual({
      pilotcli: want,
      skillsDir: '/home/.agents/skills'
    })
  })
})

describe('sourceIndexReader', () => {
  it('reads once a minute at most', async () => {
    let now = 0
    const read = vi.fn(async () => ({ pilotcli: null, skillsDir: '/s' }))
    const get = sourceIndexReader(read, () => now)
    await get()
    now = 59_000
    await get()
    expect(read).toHaveBeenCalledTimes(1)
    now = 61_000
    await get()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
