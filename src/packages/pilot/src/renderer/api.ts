import { isWebClientLocation } from '@/lib/web-client-location'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

const DEFAULT_TIMEOUT_MS = 15_000

// The browser version's runtime.call drops timeoutMs (a 30 s cap); its active environment keeps it.
function pilotRpcTarget(): RuntimeClientTarget {
  if (isWebClientLocation()) {
    return { kind: 'environment', environmentId: 'active' }
  }
  return { kind: 'local' }
}

// M0/M1 talk to the local runtime. Paired-environment targets (D25) come with the timeline work in M2.
// Long calls (dry run, Run now) pass a larger timeoutMs.
export function pilotRpc<T>(
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number }
): Promise<T> {
  return callRuntimeRpc<T>(pilotRpcTarget(), method, params, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  })
}
