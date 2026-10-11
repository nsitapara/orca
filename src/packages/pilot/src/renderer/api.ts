import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

const DEFAULT_TIMEOUT_MS = 15_000

// M0/M1 talk to the local runtime. Paired-environment targets (D25) come with the timeline work in M2.
// Long calls (dry run, Run now) pass a larger timeoutMs.
export function pilotRpc<T>(
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number }
): Promise<T> {
  return callRuntimeRpc<T>({ kind: 'local' }, method, params, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  })
}
