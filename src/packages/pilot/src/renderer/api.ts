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

// An explicit local target is this window's own Pilot too (LOCAL_PILOT_HOST.target), so it keeps the browser's route.
function targetOf(target: RuntimeClientTarget | undefined): RuntimeClientTarget {
  if (!target || target.kind === 'local') {
    return pilotRpcTarget()
  }
  return target
}

// A caller's environment target wins; long calls (dry run, Run now) pass a larger timeoutMs.
export function pilotRpc<T>(
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number; target?: RuntimeClientTarget }
): Promise<T> {
  return callRuntimeRpc<T>(targetOf(opts?.target), method, params, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  })
}
