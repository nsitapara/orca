import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { fieldsForRun } from '../inbox/run-fields'
import { completePreparation, prepareEvidence, retryPreparation } from '../inbox/preparation'
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

export const RETRY_BY_PERSON = "Retry preparation from Pilot's window or a paired device"
export const EVIDENCE_BY_PERSON = "Prepare evidence from Pilot's window or a paired device"

export const byPerson = (caller: RpcCallerIdentity | undefined): boolean =>
  caller?.kind === 'desktop' || caller?.kind === 'paired-device'

export function buildPreparationMethods(ctx: () => PilotContext) {
  return [
    // A person's Prepare evidence on an imported or legacy push or drafted card (R-P5): it queues the card for
    // job 14 with a request built from the card. The desktop or a paired device only, never the local CLI.
    defineMethod({
      name: 'pilot.inbox.prepareEvidence',
      permission: 'workspace',
      params: z.object({ id: z.string().min(1) }),
      handler: (p, rpc) => {
        if (!byPerson(rpc.caller)) {
          throw new Error(EVIDENCE_BY_PERSON)
        }
        return prepareEvidence(inboxDeps(ctx()), p.id)
      }
    }),
    // A person's Retry on a blocked card (the Inbox's button): the desktop or a paired device, never the local CLI,
    // where any agent runs. It only requeues; the worker job still claims it under R-P1's scope.
    defineMethod({
      name: 'pilot.inbox.prepareRetry',
      permission: 'workspace',
      params: z.object({ id: z.string().min(1) }),
      handler: (p, rpc) => {
        const kind = rpc.caller?.kind
        if (kind !== 'desktop' && kind !== 'paired-device') {
          throw new Error(RETRY_BY_PERSON)
        }
        return retryPreparation(inboxDeps(ctx()), p.id)
      }
    }),
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
