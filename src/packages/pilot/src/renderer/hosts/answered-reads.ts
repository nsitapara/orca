import type { HostRead } from './host-poll'
import type { PilotHostEntry, PilotHostRef } from './pilot-host'

export type Answered<T> = { host: PilotHostRef; value: T }
export type AnsweredRead<T> = Answered<T> & { entry: PilotHostEntry }

export function refOf(host: PilotHostEntry): PilotHostRef {
  return { key: host.key, target: host.target, machineName: host.machineName, local: host.local }
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
