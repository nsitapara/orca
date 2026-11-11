import './unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { setActiveSink } from '../../observability/tracer'
import { OrcaRuntimeService } from '../orca-runtime'
import {
  defineMethod,
  type RpcAnyMethodDeclaration,
  type RpcRequest,
  type RpcResponse
} from './core'
import { RpcDispatcher } from './dispatcher'

// Moved from upstream's dispatcher-transport-parity.test.ts, which upstream deleted.
type Transport = 'dispatch' | 'streaming'
const TRANSPORTS: readonly Transport[] = ['dispatch', 'streaming']
const AnyParams = z.record(z.string(), z.unknown())

async function call(
  dispatcher: RpcDispatcher,
  transport: Transport,
  request: RpcRequest
): Promise<RpcResponse> {
  if (transport === 'dispatch') {
    return dispatcher.dispatch(request)
  }
  const replies: string[] = []
  await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply))
  return JSON.parse(replies[0]!)
}

describe('RpcDispatcher slow request trace', () => {
  const records: unknown[] = []
  const takeMs = (ms: number): void => {
    vi.setSystemTime(Date.now() + ms)
  }

  beforeEach(() => {
    records.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    setActiveSink({ push: (record) => records.push(record), flush() {}, close() {} })
  })

  afterEach(() => {
    setActiveSink(null)
    vi.useRealTimers()
  })

  function slowMethods(): RpcAnyMethodDeclaration[] {
    return [
      defineMethod({
        name: 'linear.issueContext',
        permission: 'workspace',
        params: AnyParams,
        handler: () => {
          takeMs(1_500)
          return { issue: { title: 'Patient intake form' } }
        }
      }),
      defineMethod({
        name: 'worktree.list',
        permission: 'workspace',
        params: AnyParams,
        handler: () => {
          takeMs(999)
          return []
        }
      }),
      defineMethod({
        name: 'linear.issueSetState',
        permission: 'workspace',
        params: AnyParams,
        handler: () => {
          takeMs(2_000)
          throw new Error('Linear rejected "Patient intake form"')
        }
      }),
      defineMethod({
        name: 'terminal.wait',
        permission: 'workspace',
        params: AnyParams,
        handler: () => {
          takeMs(30_000)
          return {}
        }
      })
    ]
  }

  function request(method: string): RpcRequest {
    return { id: `rpc-${method}`, authToken: 'token', method, params: { input: 'ENG-1 secret' } }
  }

  // Why: a freezing main thread showed up first as slow RPCs, which nothing recorded.
  it.each(TRANSPORTS)(
    'traces only RPCs slower than 1s over %s, by method and error code alone',
    async (transport) => {
      const dispatcher = new RpcDispatcher({
        runtime: new OrcaRuntimeService(),
        methods: slowMethods()
      })
      for (const method of [
        'linear.issueContext',
        'worktree.list',
        'linear.issueSetState',
        'terminal.wait'
      ]) {
        await call(dispatcher, transport, request(method))
      }

      expect(records).toEqual([
        expect.objectContaining({
          name: 'runtime.rpc',
          durationMs: 1_500,
          attributes: { kind: 'runtime-rpc', 'rpc.method': 'linear.issueContext' },
          exit: { _tag: 'Success' }
        }),
        expect.objectContaining({
          name: 'runtime.rpc',
          durationMs: 2_000,
          attributes: { kind: 'runtime-rpc', 'rpc.method': 'linear.issueSetState' },
          exit: { _tag: 'Failure', cause: 'rpc error runtime_error' }
        })
      ])
      expect(JSON.stringify(records)).not.toMatch(/Patient|secret/)
    }
  )
})
