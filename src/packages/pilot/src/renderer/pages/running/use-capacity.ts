import { useCallback, useEffect, useState } from 'react'
import type { CapacityPayload, RetryKey } from '../../../shared/api-types-capacity'
import { answered } from '../../hosts/answered-reads'
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

// Runs going and waiting for a slot across every machine that answered; a failed read keeps its machine's last figures.
export function capacityTotals(reads: readonly HostRead<CapacityPayload>[]): {
  running: number
  queued: number
} {
  return answered(reads).reduce(
    (sum, { value }) => ({
      running: sum.running + value.running.length,
      queued: sum.queued + value.queued.length
    }),
    { running: 0, queued: 0 }
  )
}

// The sidebar's Running count.
export function useCapacityTotals(): { running: number; queued: number } {
  const { reads } = useHostPoll<CapacityPayload>(
    'pilot.capacity.get',
    undefined,
    CAPACITY_POLL_MS,
    {
      skipHidden: true
    }
  )
  return capacityTotals(reads)
}

// What a change (a limit, a Retry) shows until a read started after `boundary` lands: the figures it answered, or why
// it failed.
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

export type CapacityChanges = {
  setLimit(host: PilotHostRef, limit: number | null): Promise<void>
  setRetryLimit(host: PilotHostRef, limit: number): Promise<void>
  retry(host: PilotHostRef, key: RetryKey): Promise<void>
}

// Every machine's figures, polled on its own; a machine's change goes to that machine alone.
export function useCapacities(): CapacityChanges & {
  machines: MachineCapacity[]
  saving: string | null
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

  // Each change answers the machine's figures after it.
  const change = useCallback(
    async (host: PilotHostRef, method: string, params: Record<string, unknown>): Promise<void> => {
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
        const payload = await hostRpc<CapacityPayload>(host, method, params)
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

  return {
    machines,
    saving,
    setLimit: (host, limit) => change(host, 'pilot.capacity.setLimit', { limit }),
    setRetryLimit: (host, limit) => change(host, 'pilot.capacity.setRetryLimit', { limit }),
    retry: (host, key) => change(host, 'pilot.capacity.retry', key)
  }
}
