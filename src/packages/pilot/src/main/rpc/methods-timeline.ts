import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotContext } from '../pilot-services'
import { buildWorktreeTimeline } from '../timeline/worktree-timeline'

const Timeline = z.object({
  worktreePath: z.string().min(1).max(4096),
  person: z.string().min(1).max(200).optional()
})

const Resume = z.object({ runId: z.string().min(1), stepIdx: z.number().int().nonnegative() })

export const RESUME_FROM_PILOT = 'Open sessions from Pilot'

export function buildTimelineMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.worktree.timeline',
      permission: 'workspace',
      params: Timeline,
      handler: (p) => {
        const c = ctx()
        return buildWorktreeTimeline(
          {
            store: c.store,
            definitions: () => c.loaded().definitions,
            nextTickAt: (def) => c.scheduler.nextTickAt(def),
            now: Date.now
          },
          p.worktreePath,
          p.person ?? null
        )
      }
    }),
    defineMethod({
      name: 'pilot.session.resume',
      permission: 'workspace',
      params: Resume,
      // A UI action: only the desktop app (the transport's stamp, never a param) may open or focus a
      // terminal here, so an agent or a paired device can't pop sessions open.
      handler: async (p, rpc) => {
        if (rpc.caller?.kind !== 'desktop') {
          throw new Error(RESUME_FROM_PILOT)
        }
        const c = ctx()
        if (!c.resumeSession) {
          throw new Error("Sessions can't be resumed in this process")
        }
        return c.resumeSession({ runId: p.runId, stepIdx: p.stepIdx })
      }
    })
  ]
}
