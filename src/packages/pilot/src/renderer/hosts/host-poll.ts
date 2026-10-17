import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../pages/format'
import { hostRpc } from './host-rpc'
import type { PilotHostEntry } from './pilot-host'
import { currentPilotHosts, subscribePilotHosts } from './pilot-hosts-feed'

// Numbered at start; a value is fresh past a change only if seq > startedSeq-at-change && error === null.
export type HostRead<T> = {
  host: PilotHostEntry
  value: T | null
  error: string | null
  seq: number
  startedSeq: number
}

export type HostPoller<T> = {
  reads(): readonly HostRead<T>[]
  refresh(): Promise<void>
  stop(): void
}

type HostPollerOptions = {
  method: string
  params?: unknown
  intervalMs: number
  skipHidden?: boolean
  onChange(): void
}

type Slot<T> = { read: HostRead<T>; inFlight: Promise<void> | null }
type Answer<T> = { value: T } | { error: string }

function sameHost(a: PilotHostEntry, b: PilotHostEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function windowHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

export function createHostPoller<T>(opts: HostPollerOptions): HostPoller<T> {
  const slots = new Map<string, Slot<T>>()
  // Survives a host's drop so a returning host never repeats a seq.
  const seqs = new Map<string, number>()
  let order: string[] = []
  let snapshot: readonly HostRead<T>[] = []
  let stopped = false

  // No params means the caller's call had none, so the local call keeps its arity.
  const ask = (host: PilotHostEntry): Promise<T> =>
    opts.params === undefined
      ? hostRpc<T>(host, opts.method)
      : hostRpc<T>(host, opts.method, opts.params)

  async function answerOf(host: PilotHostEntry): Promise<Answer<T>> {
    try {
      return { value: await ask(host) }
    } catch (error) {
      return { error: errorText(error) }
    }
  }

  function rebuild(): boolean {
    const next = order.flatMap((key) => {
      const slot = slots.get(key)
      return slot ? [slot.read] : []
    })
    const changed = next.length !== snapshot.length || next.some((r, i) => r !== snapshot[i])
    if (changed) {
      snapshot = next
    }
    return changed
  }

  function notify(): void {
    if (rebuild()) {
      opts.onChange()
    }
  }

  function isCurrent(slot: Slot<T>): boolean {
    return !stopped && slots.get(slot.read.host.key) === slot
  }

  function settle(slot: Slot<T>, seq: number, answer: Answer<T>): void {
    slot.inFlight = null
    // Keeps onChange quiet after stop(); a dropped slot is already out of the snapshot.
    if (!isCurrent(slot)) {
      return
    }
    slot.read =
      'error' in answer
        ? { ...slot.read, error: answer.error, seq }
        : { ...slot.read, value: answer.value, error: null, seq }
    notify()
  }

  function read(slot: Slot<T>): Promise<void> {
    const key = slot.read.host.key
    const seq = (seqs.get(key) ?? 0) + 1
    seqs.set(key, seq)
    slot.read = { ...slot.read, startedSeq: seq }
    const done = answerOf(slot.read.host).then((answer) => settle(slot, seq, answer))
    slot.inFlight = done
    return done
  }

  async function refreshSlot(slot: Slot<T>): Promise<void> {
    if (slot.inFlight) {
      await slot.inFlight
    }
    if (!isCurrent(slot)) {
      return
    }
    // A read started since this refresh was asked (another refresh's) answers it too.
    if (!slot.inFlight) {
      void read(slot)
      notify()
    }
    await slot.inFlight
  }

  function sync(): Slot<T>[] {
    const online = currentPilotHosts().filter((host) => host.state === 'online')
    const keys = new Set(online.map((host) => host.key))
    for (const key of slots.keys()) {
      if (!keys.has(key)) {
        slots.delete(key)
      }
    }
    const added: Slot<T>[] = []
    for (const host of online) {
      const slot = slots.get(host.key)
      if (!slot) {
        const last = seqs.get(host.key) ?? 0
        const pending: HostRead<T> = { host, value: null, error: null, seq: last, startedSeq: last }
        const fresh: Slot<T> = { read: pending, inFlight: null }
        slots.set(host.key, fresh)
        added.push(fresh)
      } else if (!sameHost(slot.read.host, host)) {
        slot.read = { ...slot.read, host }
      }
    }
    order = online.map((host) => host.key)
    return added
  }

  function tick(): void {
    if (opts.skipHidden && windowHidden()) {
      return
    }
    for (const slot of slots.values()) {
      if (!slot.inFlight) {
        void read(slot)
      }
    }
    notify()
  }

  // Construction stays silent: the caller reads reads() itself, and its first refresh() asks.
  sync()
  rebuild()
  const unsubscribe = subscribePilotHosts(() => {
    sync().forEach((slot) => void read(slot))
    notify()
  })
  const timer = setInterval(tick, opts.intervalMs)

  return {
    reads: () => snapshot,
    async refresh() {
      await Promise.all([...slots.values()].map(refreshSlot))
    },
    stop() {
      stopped = true
      clearInterval(timer)
      unsubscribe()
    }
  }
}

export function useHostPoll<T>(
  method: string,
  params: unknown,
  intervalMs: number,
  opts?: { skipHidden?: boolean }
): {
  reads: readonly HostRead<T>[]
  reload(): Promise<void>
  latest(): readonly HostRead<T>[]
} {
  const [reads, setReads] = useState<readonly HostRead<T>[]>([])
  const poller = useRef<HostPoller<T> | null>(null)
  const latestParams = useRef(params)
  // Callers pass a fresh params object each render; only a change in its content restarts the poll.
  const paramsKey = JSON.stringify(params)
  const skipHidden = opts?.skipHidden ?? false
  useEffect(() => {
    latestParams.current = params
  })
  useEffect(() => {
    const p: HostPoller<T> = createHostPoller<T>({
      method,
      params: latestParams.current,
      intervalMs,
      skipHidden,
      onChange: () => setReads(p.reads())
    })
    poller.current = p
    void p.refresh()
    return () => {
      p.stop()
      if (poller.current === p) {
        poller.current = null
      }
    }
  }, [method, paramsKey, intervalMs, skipHidden])
  const reload = useCallback(() => poller.current?.refresh() ?? Promise.resolve(), [])
  // The reads as of now, ahead of the next render: a change's boundary must count a read just started.
  const latest = useCallback(() => poller.current?.reads() ?? [], [])
  return { reads, reload, latest }
}
