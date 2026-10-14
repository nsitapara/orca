import { describe, expect, it } from 'vitest'
import { stopOrphanCreate, type OrphanDeps } from './orphan-create'

function fakes(command: string | null, aliveChecks: number, pidText: string | null = '4242') {
  const signals: [number, string][] = []
  let checks = 0
  const deps: OrphanDeps = {
    read: () => pidText,
    commandOf: () => command,
    kill: (pid, signal) => {
      signals.push([pid, signal])
    },
    alive: () => {
      checks += 1
      return checks <= aliveChecks
    },
    sleep: async () => {}
  }
  return { deps, signals }
}

describe('stopOrphanCreate', () => {
  it.each([
    [
      'its very create: TERM to its group',
      '/Users/n/.local/bin/pilotcli env create --run r1 --worktree /wt/a',
      0,
      [[-4242, 'SIGTERM']]
    ],
    [
      'alive past 10 s: then KILL',
      'pilotcli env create --run r1 --worktree /wt/a',
      1000,
      [
        [-4242, 'SIGTERM'],
        [-4242, 'SIGKILL']
      ]
    ],
    ['a pid the OS reused: never signalled', '/usr/bin/vim notes.md', 0, []],
    [
      "another run's create (r10): never signalled",
      'pilotcli env create --run r10 --worktree /wt/b',
      0,
      []
    ],
    ['no pid file: nothing', null, 0, []]
  ] as const)('%s', async (_name, command, aliveChecks, signals) => {
    const f = fakes(command, aliveChecks, command === null ? null : '4242')
    await stopOrphanCreate('/nowhere/r1.pid', 'r1', f.deps)
    expect(f.signals).toEqual(signals)
  })
})
