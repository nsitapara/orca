import { useCallback, useEffect, useState } from 'react'
import type { CapacityPayload } from '../../../shared/api-types-capacity'
import { pilotRpc } from '../../api'
import { useHostPoll, type HostRead } from '../../hosts/host-poll'
import { hostRpc } from '../../hosts/host-rpc'
import type { PilotHostEntry, PilotHostRef } from '../../hosts/pilot-host'
import { usePilotHosts } from '../../hosts/pilot-hosts-feed'
import { errorText } from '../format'

// Runs start and end within a few seconds of each other; the memory behind the figures is sampled every 15 s.
export const CAPACITY_POLL_MS = 5_000

export type MachineCapacity = {
  host: PilotHostEntry
  payload: CapacityPayload | null
  error: string | null
}

// This machine's figures alone: the sidebar's Running count.
export function useCapacity(): { payload: CapacityPayload | null } {
  const [payload, setPayload] = useState<CapacityPayload | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      if (document.hidden) {
        return
      }
      pilotRpc<CapacityPayload>('pilot.capacity.get').then(
        (p) => alive && setPayload(p),
        () => {}
      )
    }
    load()
    const timer = setInterval(load, CAPACITY_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return { payload }
}

// What a limit change shows until a read started after `boundary` lands: the figures it answered, or why it failed.
type Change = { boundary: number; payload: CapacityPayload | null; error: string | null }
type Shown = Pick<MachineCapacity, 'payload' | 'error'>

function readOf(
  reads: readonly HostRead<CapacityPayload>[],
  key: string
): HostRead<CapacityPayload> | undefined {
  return reads.find((r) => r.host.key === key)
}

// Started after the change and answered with figures (a returning machine's first slot has none yet).
function freshPast(read: HostRead<CapacityPayload> | undefined, boundary: number): boolean {
  return read !== undefined && read.seq > boundary && read.error === null && read.value !== null
}

function shownOf(read: HostRead<CapacityPayload> | undefined, change: Change | undefined): Shown {
  if (!change || freshPast(read, change.boundary)) {
    return { payload: read?.value ?? null, error: read?.error ?? null }
  }
  return {
    payload: change.payload ?? read?.value ?? null,
    error: change.error ?? read?.error ?? null
  }
}

function withChange(
  changes: ReadonlyMap<string, Change>,
  key: string,
  change: Change
): ReadonlyMap<string, Change> {
  return new Map(changes).set(key, change)
}

// Every machine's figures, polled on its own; a machine's limit change goes to that machine alone.
export function useCapacities(): {
  machines: MachineCapacity[]
  saving: string | null
  setLimit(host: PilotHostRef, limit: number | null): Promise<void>
} {
  const hosts = usePilotHosts()
  const { reads, latest } = useHostPoll<CapacityPayload>(
    'pilot.capacity.get',
    undefined,
    CAPACITY_POLL_MS,
    { skipHidden: true }
  )
  const [changes, setChanges] = useState<ReadonlyMap<string, Change>>(() => new Map())
  const [saving, setSaving] = useState<string | null>(null)

  // Once a fresh read lands the change gives way, so a later failed read keeps that read's figures.
  useEffect(() => {
    setChanges((current) => {
      const kept = [...current].filter(([key, c]) => !freshPast(readOf(reads, key), c.boundary))
      return kept.length === current.size ? current : new Map(kept)
    })
  }, [reads])

  const machines = hosts.map((host): MachineCapacity => {
    // An unreachable machine's last figures are never shown as current.
    if (host.state === 'offline') {
      return { host, payload: null, error: null }
    }
    return { host, ...shownOf(readOf(reads, host.key), changes.get(host.key)) }
  })

  const setLimit = useCallback(
    async (host: PilotHostRef, limit: number | null): Promise<void> => {
      const startedNow = (): number => readOf(latest(), host.key)?.startedSeq ?? 0
      const read = readOf(latest(), host.key)
      setChanges((current) =>
        withChange(current, host.key, {
          ...shownOf(read, current.get(host.key)),
          boundary: read?.startedSeq ?? 0
        })
      )
      setSaving(host.key)
      let answer: { payload: CapacityPayload | null; error: string | null }
      try {
        const payload = await hostRpc<CapacityPayload>(host, 'pilot.capacity.setLimit', { limit })
        answer = { payload, error: null }
      } catch (e) {
        answer = { payload: null, error: errorText(e) }
      }
      // The answer stays until a read started after it lands, so a refusal is never raced away.
      const answeredAt = startedNow()
      setChanges((current) =>
        withChange(current, host.key, {
          payload: answer.payload ?? current.get(host.key)?.payload ?? null,
          error: answer.error,
          boundary: answeredAt
        })
      )
      setSaving((key) => (key === host.key ? null : key))
    },
    [latest]
  )

  return { machines, saving, setLimit }
}
