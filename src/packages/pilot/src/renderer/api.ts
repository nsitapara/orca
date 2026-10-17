import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

const DEFAULT_TIMEOUT_MS = 15_000

// Local unless a caller names a paired machine; long calls (dry run, Run now) pass a larger timeoutMs.
export function pilotRpc<T>(
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number; target?: RuntimeClientTarget }
): Promise<T> {
  return callRuntimeRpc<T>(opts?.target ?? { kind: 'local' }, method, params, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  })
}
