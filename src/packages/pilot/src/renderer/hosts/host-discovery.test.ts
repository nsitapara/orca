import { describe, expect, it, vi } from 'vitest'
import type { PilotStatus } from '../../shared/api-types'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { discoverPilotHosts, type EnvironmentContact, type DiscoveryDeps } from './host-discovery'
import { environmentHostKey, hostedKey, hostOf, LOCAL_PILOT_HOST } from './pilot-host'
import { localStorageKnownHosts, type KnownPilotHosts } from './known-hosts'

const MINI_ENV = { id: 'mini', name: 'mini-env' }
const SELF_ENV = { id: 'self', name: 'self-env' }
const NOT_FOUND = new RuntimeRpcCallError({
  ok: false,
  id: 'x',
  error: { code: 'method_not_found', message: 'Unknown method: pilot.status' }
})

function status(machineName?: string, dataPath = '/other'): PilotStatus {
  return {
    version: '1',
    process: 'main',
    dataPath,
    machineName,
    schedulerOn: true,
    automationDirs: [],
    missingDirs: [],
    peopleError: null,
    error: null,
    loopStartedAt: null,
    lastLoopFinishedAt: null,
    orcaAutomationsOff: true
  }
}

type Answer = PilotStatus | Error | EnvironmentContact

function memoryKnown(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial))
  const known: KnownPilotHosts = {
    get: (id) => store.get(id) ?? null,
    remember: (id, name) => void store.set(id, name),
    forget: (id) => void store.delete(id)
  }
  return { known, store }
}

function deps(
  envs: { id: string; name: string }[],
  answers: Record<string, Answer>,
  known: Record<string, string>
) {
  const memory = memoryKnown(known)
  const statusFn = vi.fn(async (target: { kind: string; environmentId?: string }) => {
    if (target.kind === 'local') {
      return status('MacBook', '/data')
    }
    const answer = answers[target.environmentId ?? '']
    if (answer instanceof Error) {
      throw answer
    }
    if (typeof answer === 'object') {
      return answer
    }
    throw new Error('no answer')
  })
  const value: DiscoveryDeps = {
    environments: envs,
    contact: (id) => {
      const answer = answers[id]
      return answer === 'revoked' || answer === 'unreachable' ? answer : 'reachable'
    },
    status: statusFn,
    runtimeMachineName: () => null,
    known: memory.known
  }
  return { value, statusFn, store: memory.store }
}

describe('discoverPilotHosts', () => {
  it.each([
    [
      'nothing but this machine, asking nothing, with no environments',
      [],
      {},
      {},
      ['local:online']
    ],
    [
      'an environment that answers pilot.status',
      [MINI_ENV],
      { mini: status('Mac mini') },
      {},
      ['local:online', 'env:mini:online']
    ],
    [
      'not stock Orca (method not found), and forgets it',
      [MINI_ENV],
      { mini: NOT_FOUND },
      { mini: 'Mac mini' },
      ['local:online'],
      true
    ],
    [
      'an unreachable environment it has seen answer as offline',
      [MINI_ENV],
      { mini: 'unreachable' as const },
      { mini: 'Mac mini' },
      ['local:online', 'env:mini:offline']
    ],
    [
      'not an unreachable environment it never saw',
      [MINI_ENV],
      { mini: 'unreachable' as const },
      {},
      ['local:online']
    ],
    [
      'not a revoked pairing, and forgets it',
      [MINI_ENV],
      { mini: 'revoked' as const },
      { mini: 'Mac mini' },
      ['local:online'],
      true
    ],
    [
      'not an environment that is this engine (same machine and data folder)',
      [SELF_ENV],
      { self: status('MacBook', '/data') },
      {},
      ['local:online']
    ]
  ])('lists %s', async (_why, envs, answers, known, expected, forgets = false) => {
    const { value, store } = deps(envs, answers, known)
    const hosts = await discoverPilotHosts(value)
    expect(hosts.map((h) => `${h.key}:${h.state}`)).toEqual(expected)
    expect(store.has('mini')).toBe(
      !forgets && ('mini' in known || expected.includes('env:mini:online'))
    )
  })

  it('asks nothing when there are no environments', async () => {
    const { value, statusFn } = deps([], {}, {})
    await discoverPilotHosts(value)
    expect(statusFn).not.toHaveBeenCalled()
  })

  it('remembers an environment that answers', async () => {
    const { value, store } = deps([MINI_ENV], { mini: status('Mac mini') }, {})
    await discoverPilotHosts(value)
    expect(store.get('mini')).toBe('Mac mini')
  })

  it("names an older Pilot by its runtime's machine name, else the environment's name", async () => {
    const older = deps([MINI_ENV], { mini: status(undefined) }, {})
    older.value.runtimeMachineName = () => 'Mini (runtime)'
    expect((await discoverPilotHosts(older.value))[1].machineName).toBe('Mini (runtime)')
    const bare = deps([MINI_ENV], { mini: status(undefined) }, {})
    expect((await discoverPilotHosts(bare.value))[1].machineName).toBe('mini-env')
  })

  it('never treats an older engine without machine identity as a duplicate', async () => {
    const { value } = deps(
      [MINI_ENV, SELF_ENV],
      { mini: status(undefined, '/data'), self: status(undefined, '/data') },
      {}
    )
    const hosts = await discoverPilotHosts(value)
    expect(hosts.map((h) => h.key)).toEqual(['local', 'env:mini', 'env:self'])
  })

  it('keeps environments in store order', async () => {
    const { value } = deps(
      [MINI_ENV, SELF_ENV],
      { mini: status('A', '/a'), self: status('B', '/b') },
      {}
    )
    expect((await discoverPilotHosts(value)).map((h) => h.key)).toEqual([
      'local',
      'env:mini',
      'env:self'
    ])
  })
})

describe('host keys', () => {
  it('keys local ids bare and remote ids under the host', () => {
    expect(hostedKey({ key: 'local', local: true }, 'a')).toBe('a')
    expect(hostedKey({ key: 'env:mini', local: false }, 'a')).toBe('env:mini/a')
    expect(environmentHostKey('mini')).toBe('env:mini')
    expect(hostOf({})).toBe(LOCAL_PILOT_HOST)
  })
})

function fakeStorage(
  get: (k: string) => string | null,
  set: (k: string, v: string) => void
): Storage {
  return {
    length: 0,
    clear: () => {},
    key: () => null,
    removeItem: () => {},
    getItem: get,
    setItem: set
  }
}

describe('localStorageKnownHosts', () => {
  it('round-trips and survives broken storage', () => {
    const data = new Map<string, string>()
    const storage = fakeStorage(
      (k) => data.get(k) ?? null,
      (k, v) => void data.set(k, v)
    )
    const known = localStorageKnownHosts(storage)
    known.remember('mini', 'Mac mini')
    expect(known.get('mini')).toBe('Mac mini')
    expect(data.has('pilot.knownHosts.v1')).toBe(true)
    known.forget('mini')
    expect(known.get('mini')).toBeNull()
    data.set('pilot.knownHosts.v1', '{bad')
    expect(known.get('mini')).toBeNull()
    const blocked = localStorageKnownHosts(
      fakeStorage(
        () => {
          throw new Error('blocked')
        },
        () => {
          throw new Error('blocked')
        }
      )
    )
    expect(() => blocked.remember('a', 'b')).not.toThrow()
    expect(blocked.get('a')).toBeNull()
  })
})
