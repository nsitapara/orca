import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotContext } from '../pilot-services'
import { buildWorktreeTimeline } from '../timeline/worktree-timeline'

const Timeline = z.object({
  worktreePath: z.string().min(1).max(4096),
  person: z.string().min(1).max(200).optional()
})

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
    })
  ]
}
