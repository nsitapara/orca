import type { HostRead } from './host-poll'
import type { PilotHostEntry, PilotHostRef } from './pilot-host'

export type Answered<T> = { host: PilotHostRef; value: T }
export type AnsweredRead<T> = Answered<T> & { entry: PilotHostEntry }

// One ref per entry: a card's host stays the same object across polls, so effects keyed on it don't restart.
const refs = new WeakMap<PilotHostEntry, PilotHostRef>()

export function refOf(host: PilotHostEntry): PilotHostRef {
  const known = refs.get(host)
  if (known) {
    return known
  }
  const ref = {
    key: host.key,
    target: host.target,
    machineName: host.machineName,
    local: host.local
  }
  refs.set(host, ref)
  return ref
}

// Only an online host with a value counts; this machine comes first, the rest keep host order.
export function answered<T>(reads: readonly HostRead<T>[]): AnsweredRead<T>[] {
  const live = reads.flatMap((r) =>
    r.value !== null && r.host.state === 'online'
      ? [{ entry: r.host, host: refOf(r.host), value: r.value }]
      : []
  )
  return [...live.filter((r) => r.host.local), ...live.filter((r) => !r.host.local)]
}
