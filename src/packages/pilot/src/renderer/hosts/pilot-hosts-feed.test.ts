import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEnvironmentStatus } from '../../../../../shared/runtime-host-status'
import type { PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { registerPilotStore, type PilotStoreState } from '../store'
import { LOCAL_PILOT_HOST } from './pilot-host'
import {
  contactOf,
  currentPilotHosts,
  resetPilotHostsFeed,
  subscribePilotHosts
} from './pilot-hosts-feed'

vi.mock('../api', () => ({ pilotRpc: vi.fn() }))

type Snapshot = NonNullable<RuntimeEnvironmentStatus['snapshot']>

function snap(overrides: Partial<Snapshot>): { snapshot: Snapshot; status: null; checkedAt: 0 } {
  const snapshot: Snapshot = {
    environmentId: 'e',
    pairingRevision: 1,
    sequence: 1,
    checkedAt: 0,
    status: null,
    verification: 'verified',
    transport: 'ready',
    ...overrides
  }
  return { snapshot, status: null, checkedAt: 0 }
}

function fakeStore(initial: Partial<PilotStoreState>) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state as PilotStoreState,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set(next: Partial<PilotStoreState>) {
      state = { ...state, ...next }
      listeners.forEach((l) => l())
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  resetPilotHostsFeed()
  registerPilotStore(null)
  vi.mocked(pilotRpc).mockReset()
})

describe('pilot hosts feed', () => {
  it.each([
    ['revoked when retired', { snapshot: snap({ retired: true }).snapshot }, 'revoked'],
    ['revoked when blocked', snap({ verification: 'blocked' }), 'revoked'],
    ['unreachable when disconnected', snap({ transport: 'disconnected' }), 'unreachable'],
    ['unreachable when unavailable', snap({ verification: 'unavailable' }), 'unreachable'],
    ['reachable with no status yet', undefined, 'reachable']
  ])('a host is %s', (_w, entry, expected) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: first row only carries a snapshot, which is all contactOf reads.
    expect(contactOf(entry as RuntimeEnvironmentStatus | undefined)).toBe(expected)
  })

  it('starts with this machine and asks nothing while no store is attached', () => {
    expect(currentPilotHosts()).toEqual([LOCAL_PILOT_HOST])
    expect(pilotRpc).not.toHaveBeenCalled()
  })

  it('probes again only when the environments or their contact change', async () => {
    const answer: PilotStatus = {
      version: '1',
      process: 'main',
      dataPath: '/x',
      machineName: 'mini',
      schedulerOn: true,
      automationDirs: [],
      missingDirs: [],
      peopleError: null,
      error: null,
      loopStartedAt: null,
      lastLoopFinishedAt: null,
      orcaAutomationsOff: true
    }
    vi.mocked(pilotRpc).mockResolvedValue(answer)
    const store = fakeStore({ runtimeEnvironments: [{ id: 'a', name: 'A' }] })
    registerPilotStore(store)
    const unsubscribe = subscribePilotHosts(() => {})
    await flush()
    const first = vi.mocked(pilotRpc).mock.calls.length
    store.set({ activeView: 'x' })
    store.set({ rightSidebarOpen: true })
    await flush()
    expect(vi.mocked(pilotRpc).mock.calls.length).toBe(first)
    store.set({
      runtimeEnvironments: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ]
    })
    await flush()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.status', undefined, {
      target: { kind: 'environment', environmentId: 'b' },
      timeoutMs: 5_000
    })
    unsubscribe()
  })
})
