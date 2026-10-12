import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { queueEntries } from '../answers/queue-view'
import { saveAnswer } from '../answers/save'
import { runBinding } from './methods-actions'
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
  via: z.enum(['page', 'cli']).optional(),
  by: z.string().min(1).max(64).optional(),
  // Where the call comes from (as pilot.action.run): an agent inside a run must not answer.
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
})
export const AGENTS_DONT_ANSWER = "Agents don't answer cards; Nish answers them in Pilot"

// A call bound to a run (its terminal's step, or the env's active step) is an agent. A binding that
// can't be resolved is still a claim to be inside a run, so it is refused too.
function refuseAgent(c: PilotContext, p: z.infer<typeof Answer>): void {
  try {
    if (runBinding(c, p) === null) {
      return
    }
  } catch {
    // fall through: it named a run it isn't in
  }
  throw new Error(AGENTS_DONT_ANSWER)
}
const QueueList = z.object({ person: z.string().min(1).optional() })

export function buildAnswerMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.answer',
      permission: 'workspace',
      params: Answer,
      // The caller kind is the transport's stamp (never a param); it is recorded on the answer, and only the
      // desktop may approve (save.ts). An agent inside a Pilot run never answers Nish's cards.
      handler: (p, rpc) => {
        const c = ctx()
        if (rpc.caller?.kind === 'local-cli') {
          refuseAgent(c, p)
        }
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
