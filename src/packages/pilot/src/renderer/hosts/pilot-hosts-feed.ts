import { useSyncExternalStore } from 'react'
import {
  isRuntimeHostContactRevoked,
  lastVerifiedRuntimeStatus,
  type RuntimeEnvironmentStatus
} from '../../../../../shared/runtime-host-status'
import type { PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { pilotStore } from '../store'
import { discoverPilotHosts, type EnvironmentContact } from './host-discovery'
import { localStorageKnownHosts } from './known-hosts'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from './pilot-host'

export const HOSTS_POLL_MS = 30_000
const STATUS_TIMEOUT_MS = 5_000

const known = localStorageKnownHosts()
const listeners = new Set<() => void>()
let hosts: readonly PilotHostEntry[] = [LOCAL_PILOT_HOST]
let detach: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let signature = ''
let probeSeq = 0

export function contactOf(entry: RuntimeEnvironmentStatus | undefined): EnvironmentContact {
  if (isRuntimeHostContactRevoked(entry)) {
    return 'revoked'
  }
  const snapshot = entry?.snapshot
  if (
    snapshot &&
    (snapshot.transport === 'disconnected' || snapshot.verification === 'unavailable')
  ) {
    return 'unreachable'
  }
  return 'reachable'
}

function environments(): readonly { id: string; name: string }[] {
  return pilotStore()?.getState().runtimeEnvironments ?? []
}

function signatureOf(): string {
  const statuses = pilotStore()?.getState().runtimeStatusByEnvironmentId
  return environments()
    .map((env) => `${env.id}:${env.name}:${contactOf(statuses?.get(env.id))}`)
    .join('|')
}

function sameEntry(a: PilotHostEntry, b: PilotHostEntry): boolean {
  return a.key === b.key && JSON.stringify(a) === JSON.stringify(b)
}

// An unchanged machine keeps its entry object, so what is keyed on a host doesn't redo its work on every probe.
function publish(next: readonly PilotHostEntry[]): void {
  const kept = next.map((entry) => hosts.find((h) => sameEntry(h, entry)) ?? entry)
  if (kept.length === hosts.length && kept.every((entry, i) => entry === hosts[i])) {
    return
  }
  hosts = kept
  listeners.forEach((listener) => listener())
}

async function probe(): Promise<void> {
  const seq = ++probeSeq
  const statuses = pilotStore()?.getState().runtimeStatusByEnvironmentId
  const next = await discoverPilotHosts({
    environments: environments(),
    contact: (id) => contactOf(statuses?.get(id)),
    status: (target) =>
      target.kind === 'local'
        ? pilotRpc<PilotStatus>('pilot.status')
        : pilotRpc<PilotStatus>('pilot.status', undefined, {
            target,
            timeoutMs: STATUS_TIMEOUT_MS
          }),
    runtimeMachineName: (id) => lastVerifiedRuntimeStatus(statuses?.get(id))?.machineName ?? null,
    known
  })
  // A slower, older probe must not overwrite a newer answer.
  if (seq === probeSeq) {
    publish(next)
  }
}

function pollIfVisible(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    void probe()
  }
}

function start(): void {
  signature = signatureOf()
  const unsubscribeStore = pilotStore()?.subscribe?.(() => {
    const next = signatureOf()
    if (next !== signature) {
      signature = next
      void probe()
    }
  })
  timer = setInterval(pollIfVisible, HOSTS_POLL_MS)
  detach = () => {
    unsubscribeStore?.()
    if (timer) {
      clearInterval(timer)
    }
    timer = null
    detach = null
  }
  pollIfVisible()
}

export function subscribePilotHosts(listener: () => void): () => void {
  listeners.add(listener)
  if (!detach && pilotStore()) {
    start()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detach?.()
    }
  }
}

export function currentPilotHosts(): readonly PilotHostEntry[] {
  return hosts
}

export function usePilotHosts(): readonly PilotHostEntry[] {
  return useSyncExternalStore(subscribePilotHosts, currentPilotHosts)
}

export function useMachineChipsShown(): boolean {
  return usePilotHosts().length > 1
}

export function setPilotHostsForTests(next: readonly PilotHostEntry[]): void {
  publish(next)
}

export function resetPilotHostsFeed(): void {
  detach?.()
  listeners.clear()
  probeSeq++
  hosts = [LOCAL_PILOT_HOST]
  signature = ''
}
