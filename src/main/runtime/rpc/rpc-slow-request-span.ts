import { startSpan } from '../../observability/tracer'
import { classifyRuntimeLongPoll } from '../runtime-rpc/runtime-rpc-long-poll'
import type { RpcRequest, RpcResponse } from './core'

// Why: every runtime RPC is served on the main thread, so a stalling main thread first shows up
// as RPCs crossing this; faster ones are not traced, to keep the trace small.
export const SLOW_RPC_SPAN_MS = 1_000

export type SlowRpcSpan = (response: RpcResponse) => void

const untraced: SlowRpcSpan = () => {}

/** Times one unary request; the trace gets only its method, never params or results, which can
 *  carry ticket text or other user content. */
export function startSlowRpcSpan(request: RpcRequest): SlowRpcSpan {
  // Long-polls wait on purpose.
  if (classifyRuntimeLongPoll(request)) {
    return untraced
  }
  const span = startSpan('runtime.rpc', {
    attributes: { kind: 'runtime-rpc', 'rpc.method': request.method },
    shouldRecord: (record) => record.durationMs >= SLOW_RPC_SPAN_MS
  })
  return (response) => {
    if (response.ok) {
      span.end()
    } else {
      span.fail(`rpc error ${response.error.code}`)
    }
  }
}
