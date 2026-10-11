import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { MAX_OUTPUT_VALUE, OUTPUT_KEY } from '../../shared/run/outputs'
import type { PilotContext } from '../pilot-services'
import {
  recordRunEvent,
  recordRunOutput,
  resolveChannelRun,
  resolveChannelStep
} from './run-channel'

export const MAX_OUTPUTS_PER_CALL = 50
export const MAX_EVENT_PAYLOAD = 64 * 1024

// Where the call comes from: the CLI's terminal handle, and the env's step as the fallback (ruling 8d).
const Target = {
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
}
const Value = z.union([z.string().max(MAX_OUTPUT_VALUE), z.number(), z.boolean(), z.null()])
const RunOutput = z.object({
  ...Target,
  outputs: z.record(z.string().regex(OUTPUT_KEY), Value).refine((o) => {
    const n = Object.keys(o).length
    return n > 0 && n <= MAX_OUTPUTS_PER_CALL
  }, `Give 1 to ${MAX_OUTPUTS_PER_CALL} outputs`)
})
const RunEvent = z.object({
  ...Target,
  kind: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (p) => p === undefined || JSON.stringify(p).length <= MAX_EVENT_PAYLOAD,
      'The payload is over 64 KB'
    )
})

// What agents call from inside a step (pilot run output | event). Same fail-soft context as the rest.
export function buildChannelMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.run.output',
      permission: 'workspace',
      params: RunOutput,
      handler: (p) => {
        const c = ctx()
        return recordRunOutput(c, { ...resolveChannelStep(c, p), outputs: p.outputs })
      }
    }),
    defineMethod({
      name: 'pilot.run.event',
      permission: 'workspace',
      params: RunEvent,
      handler: (p) => {
        const c = ctx()
        return recordRunEvent(c, {
          runId: resolveChannelRun(c, p),
          kind: p.kind,
          payload: p.payload
        })
      }
    })
  ]
}
