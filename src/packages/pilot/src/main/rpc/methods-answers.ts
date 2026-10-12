import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { queueEntries } from '../answers/queue-view'
import { saveAnswer } from '../answers/save'
import type { PilotContext } from '../pilot-services'
import { inboxDeps } from './methods-inbox'

const Answer = z.object({
  id: z.string().min(1),
  option: z.number().int().nonnegative().optional(),
  text: z.string().max(4000).optional(),
  digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  by: z.string().min(1).max(64).optional()
})
const QueueList = z.object({ person: z.string().min(1).optional() })

export function buildAnswerMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.answer',
      permission: 'workspace',
      params: Answer,
      // The caller kind is the transport's stamp (never a param): it is recorded on the answer, and save.ts
      // lets the local CLI nowhere near a card, a paired device answer but never approve, the desktop all.
      handler: (p, rpc) => {
        const c = ctx()
        return saveAnswer(inboxDeps(c), p, {
          callerKind: rpc.caller?.kind ?? null,
          catalog: c.actions
        })
      }
    }),
    defineMethod({
      name: 'pilot.queue.list',
      permission: 'workspace',
      params: QueueList,
      handler: (p) => {
        const c = ctx()
        return { entries: queueEntries(inboxDeps(c), c.actions, p) }
      }
    })
  ]
}
