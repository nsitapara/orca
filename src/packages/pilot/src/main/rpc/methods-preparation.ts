import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { fieldsForRun } from '../inbox/run-fields'
import { completePreparation } from '../inbox/preparation'
import { runBinding, type CallBinding } from './run-binding'
import { inboxDeps } from './methods-inbox'

const Claim = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
})
const Attempt = Claim.extend({ attempt: z.number().int().positive() })

export function preparationBinding(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  p: CallBinding & { id: string; revision: number }
): { runId: string; stepIdx: number } {
  if (caller?.kind !== 'local-cli') {
    throw new Error('Context preparation requires an active Pilot worker step')
  }
  const bound = runBinding(c, p)
  if (!bound) {
    throw new Error('Context preparation requires an active Pilot worker step')
  }
  const run = c.store.runs.get(bound.runId)
  const definition = c.loaded().definitions.find((d) => d.id === run?.automationId)
  const fields = fieldsForRun(c.store, bound.runId)
  const prep = c.store.inbox.get(p.id)?.preparation
  const alreadyClaimed =
    prep?.runId === bound.runId && prep.stepIdx === bound.stepIdx && prep.revision === p.revision
  if (
    definition?.items?.kind !== 'inbox_preparation' ||
    run?.itemKey !== p.id ||
    (!alreadyClaimed &&
      (fields['preparation.item_id'] !== p.id || fields['preparation.revision'] !== p.revision))
  ) {
    throw new Error('This preparation run has no grant for this inbox item revision')
  }
  return bound
}

export function buildPreparationMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.prepareClaim',
      permission: 'workspace',
      params: Claim,
      handler: (p, rpc) => {
        const c = ctx()
        const bound = preparationBinding(c, rpc.caller, p)
        return c.store.transaction(() =>
          c.store.inboxPreparations.claim(p.id, p.revision, bound.runId, bound.stepIdx, Date.now())
        )
      }
    }),
    defineMethod({
      name: 'pilot.inbox.prepareProgress',
      permission: 'workspace',
      params: Attempt.extend({ message: z.string().min(1).max(2000) }),
      handler: (p, rpc) => {
        const c = ctx()
        const bound = preparationBinding(c, rpc.caller, p)
        return c.store.transaction(() =>
          c.store.inboxPreparations.progress(p.id, { ...p, ...bound }, p.message, Date.now())
        )
      }
    }),
    defineMethod({
      name: 'pilot.inbox.prepareComplete',
      permission: 'workspace',
      params: Attempt.extend({ bundlePath: z.string().min(1).max(4096) }),
      handler: (p, rpc) => {
        const c = ctx()
        const bound = preparationBinding(c, rpc.caller, p)
        return completePreparation(inboxDeps(c), p.id, { ...p, ...bound }, p.bundlePath)
      }
    }),
    defineMethod({
      name: 'pilot.inbox.prepareFail',
      permission: 'workspace',
      params: Attempt.extend({ error: z.string().min(1).max(4000), retry: z.boolean().optional() }),
      handler: (p, rpc) => {
        const c = ctx()
        const bound = preparationBinding(c, rpc.caller, p)
        return c.store.transaction(() =>
          c.store.inboxPreparations.fail(
            p.id,
            { ...p, ...bound },
            p.error,
            p.retry ?? false,
            Date.now()
          )
        )
      }
    })
  ]
}
