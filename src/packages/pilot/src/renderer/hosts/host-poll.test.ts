// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from './pilot-hosts-feed'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { createHostPoller, useHostPoll, type HostPoller } from './host-poll'

const POLL_MS = 10_000
let poller: HostPoller<unknown> | null = null

function poll(opts: { skipHidden?: boolean } = {}): HostPoller<unknown> {
  poller = createHostPoller<unknown>({
    method: 'pilot.inbox.list',
    intervalMs: POLL_MS,
    onChange: () => {},
    ...opts
  })
  return poller
}

const readOf = (p: HostPoller<unknown>, key: string) => p.reads().find((r) => r.host.key === key)
const flush = () => vi.advanceTimersByTimeAsync(0)

function asked(hostKey: string): number {
  return pilotRpc.mock.calls.filter(
    ([, , opts]) => (opts?.target?.environmentId ?? 'local') === hostKey
  ).length
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  poller?.stop()
  poller = null
  resetPilotHostsFeed()
  pilotRpc.mockReset()
  Reflect.deleteProperty(document, 'hidden')
  vi.useRealTimers()
})

describe('createHostPoller', () => {
  it('a host that never answers holds back neither the others nor the next poll (Review Focus 4)', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    let answers = 0
    pilotRpc.mockImplementation(
      byHost({ local: () => ++answers, mini: () => new Promise(() => {}) })
    )
    const p = poll()
    void p.refresh()
    await flush()
    expect(readOf(p, 'local')?.value).toBe(1)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(readOf(p, 'local')?.value).toBe(2)
    expect([asked('local'), asked('mini')]).toEqual([2, 1])
  })

  it.each([
    ['goes offline', [LOCAL_NAMED, MINI_OFFLINE]],
    ['is no longer listed', [LOCAL_NAMED]]
  ])(
    "keeps a host's last read with its error when a read fails, and drops a host that %s",
    async (_w, after) => {
      setPilotHostsForTests([LOCAL_NAMED, MINI])
      let miniFails = false
      pilotRpc.mockImplementation(
        byHost({
          local: () => 'l',
          mini: () => {
            if (miniFails) {
              throw new Error('timeout')
            }
            return 'm'
          }
        })
      )
      const p = poll()
      await p.refresh()
      miniFails = true
      await p.refresh()
      expect(readOf(p, 'env:mini')).toMatchObject({ value: 'm', error: 'timeout', seq: 2 })
      setPilotHostsForTests(after)
      expect(p.reads().map((r) => r.host.key)).toEqual(['local'])
    }
  )

  it("never shows, or asks again for, a dropped host's late read, even once the host is back", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const late = deferred<string>()
    const fresh = deferred<string>()
    const mini = [late, fresh]
    pilotRpc.mockImplementation(byHost({ local: () => 'l', mini: () => mini.shift()?.promise }))
    const p = poll()
    void p.refresh()
    void p.refresh()
    await flush()
    setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE])
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    late.resolve('stale')
    await flush()
    expect(readOf(p, 'env:mini')).toMatchObject({ value: null, error: null })
    expect(asked('mini')).toBe(2)
    fresh.resolve('fresh')
    await flush()
    expect(readOf(p, 'env:mini')?.value).toBe('fresh')
  })

  it('reads again after a reload asked while a poll was in flight', async () => {
    setPilotHostsForTests([LOCAL_NAMED])
    const first = deferred<string>()
    const second = deferred<string>()
    const answers = [first, second]
    pilotRpc.mockImplementation(() => answers.shift()?.promise)
    const p = poll()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    let reloaded = false
    const reload = p.refresh().then(() => {
      reloaded = true
    })
    expect(pilotRpc).toHaveBeenCalledTimes(1)
    first.resolve('first')
    await flush()
    expect([pilotRpc.mock.calls.length, reloaded]).toEqual([2, false])
    second.resolve('second')
    await reload
    expect(p.reads()).toMatchObject([{ value: 'second', error: null, seq: 2 }])
  })

  it.each([
    ['skips', true, 0],
    ['keeps', false, 1]
  ])("%s a hidden window's polls when skipHidden is %s", async (_w, skipHidden, times) => {
    setPilotHostsForTests([LOCAL_NAMED])
    pilotRpc.mockResolvedValue('l')
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    poll({ skipHidden })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(pilotRpc).toHaveBeenCalledTimes(times)
  })
})

describe('useHostPoll', () => {
  it('polls while mounted, and again only when the params change', async () => {
    setPilotHostsForTests([LOCAL_NAMED])
    pilotRpc.mockImplementation(
      async (_method: string, params: { person: string }) => params.person
    )
    const hook = renderHook(
      ({ person }: { person: string }) =>
        useHostPoll<string>('pilot.inbox.list', { person }, POLL_MS),
      { initialProps: { person: 'nish' } }
    )
    await act(() => flush())
    hook.rerender({ person: 'nish' })
    await act(() => flush())
    expect(hook.result.current.reads.map((r) => r.value)).toEqual(['nish'])
    hook.rerender({ person: 'emil' })
    await act(() => flush())
    expect(hook.result.current.reads.map((r) => r.value)).toEqual(['emil'])
    expect(pilotRpc.mock.calls).toStrictEqual([
      ['pilot.inbox.list', { person: 'nish' }],
      ['pilot.inbox.list', { person: 'emil' }]
    ])
    hook.unmount()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(pilotRpc).toHaveBeenCalledTimes(2)
  })
})
