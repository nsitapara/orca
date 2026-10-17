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
const ApplyNow = z.object({ ids: z.array(z.string().min(1)).max(200).optional() })

export const APPLY_NOW_ELSEWHERE =
  "Answers are applied by the Pilot app that runs the scheduler; this process doesn't run it"
export const APPLY_NOW_NO_CALLER = "Pilot can't tell who is calling; nothing was applied"

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
      name: 'pilot.answers.applyNow',
      permission: 'workspace',
      params: ApplyNow,
      // apply.py now: skip the settle for these answers (all, without ids), then run a pass. Who may hurry
      // an approval past its settle is the transport's stamp, never a param: only the desktop app; any
      // other caller (a paired device, the local CLI, so any agent) settles only answers that run no action.
      handler: async (p, rpc) => {
        const c = ctx()
        if (!c.dispatcher) {
          throw new Error(APPLY_NOW_ELSEWHERE)
        }
        const kind = rpc.caller?.kind
        if (!kind) {
          throw new Error(APPLY_NOW_NO_CALLER)
        }
        const ids = p.ids ? { ids: p.ids } : {}
        return c.dispatcher.applyNow({ ...ids, approver: kind === 'desktop' })
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
