import { pilotRpc } from '../api'
import type { PilotHostRef } from './pilot-host'

type HostCall = [method: string, params?: unknown, opts?: { timeoutMs?: number }]

// A local call forwards the caller's exact arguments, so existing call assertions keep holding.
export function hostRpc<T>(host: PilotHostRef, ...call: HostCall): Promise<T> {
  if (host.local) {
    return pilotRpc<T>(...call)
  }
  const [method, params, opts] = call
  return pilotRpc<T>(method, params, { ...opts, target: host.target })
}
