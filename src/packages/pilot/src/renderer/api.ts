import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

// M0/M1 talk to the local runtime. Paired-environment targets (D25) come with the timeline work in M2.
export function pilotRpc<T>(method: string, params?: unknown): Promise<T> {
  return callRuntimeRpc<T>({ kind: 'local' }, method, params, { timeoutMs: 15_000 })
}
