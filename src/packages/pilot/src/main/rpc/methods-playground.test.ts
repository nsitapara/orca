import { describe, expect, it, vi } from 'vitest'
import type { PlaygroundService } from '../playground/playground'
import {
  buildPlaygroundMethods,
  PLAYGROUND_NO_CALLER,
  PLAYGROUND_NOT_HERE,
  PLAYGROUND_NOT_PAIRED
} from './methods-playground'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, rpc?: { caller?: { kind: string } }): unknown
}

const STOPPED = { state: 'stopped', repoPath: null, reason: null } as const

function methods(playground: Partial<PlaygroundService> | undefined): Map<string, Callable> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each test calls only the service methods it gives.
  const ctx = { playground: playground as PlaygroundService | undefined }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: defineMethod's objects have name, params and handler; the tests call handlers with valid params.
  const list = buildPlaygroundMethods(() => ctx) as unknown as Callable[]
  return new Map(list.map((m) => [m.name, m]))
}

const DESKTOP = { caller: { kind: 'desktop' } }

describe('pilot.playground', () => {
  it('starts and stops the playground for this Mac, never for a paired device or an unknown caller', async () => {
    const start = vi.fn(async () => STOPPED)
    const stop = vi.fn(async () => STOPPED)
    const m = methods({ start, stop })
    await m.get('pilot.playground.start')!.handler({ repoPath: '/r/web' }, DESKTOP)
    await m.get('pilot.playground.stop')!.handler(null, DESKTOP)
    expect(start).toHaveBeenCalledWith('/r/web')
    expect(stop).toHaveBeenCalledTimes(1)
    for (const [rpc, error] of [
      [{ caller: { kind: 'paired-device' } }, PLAYGROUND_NOT_PAIRED],
      [{}, PLAYGROUND_NO_CALLER]
    ] as const) {
      expect(() => m.get('pilot.playground.start')!.handler({ repoPath: '/r/web' }, rpc)).toThrow(
        error
      )
      expect(() => m.get('pilot.playground.stop')!.handler(null, rpc)).toThrow(error)
    }
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('reads the projects and the status', async () => {
    const projects = [{ path: '/r/web', name: 'web-platform', project: 'web-platform' }]
    const m = methods({ projects: async () => projects, status: () => STOPPED })
    expect(await m.get('pilot.playground.projects')!.handler(null)).toEqual(projects)
    expect(m.get('pilot.playground.status')!.handler(null)).toEqual(STOPPED)
  })

  it('says where the playground runs when this process has none', () => {
    expect(() => methods(undefined).get('pilot.playground.status')!.handler(null)).toThrow(
      PLAYGROUND_NOT_HERE
    )
  })

  it.each([
    [{ repoPath: '/r/web' }, true],
    [{ repoPath: '' }, false],
    [{}, false]
  ])('start params %o valid: %s', (params, ok) => {
    expect(methods({}).get('pilot.playground.start')!.params!.safeParse(params).success).toBe(ok)
  })
})
