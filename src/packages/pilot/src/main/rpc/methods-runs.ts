import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotContext } from '../pilot-services'
import { activityList, runDetail } from './run-views'

export const DEFAULT_RUNS_LIMIT = 100
export const MAX_RUNS_LIMIT = 300

const ActivityList = z.object({
  automationIds: z.array(z.string().min(1)).max(200).optional(),
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_RUNS_LIMIT).optional(),
  skipQuiet: z.boolean().optional()
})
const RunGet = z.object({ runId: z.string().min(1) })

// Activity across automations and the run panel (spec §4): reads only, so a paired device may call them too.
export function buildRunMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.activity.list',
      permission: 'workspace',
      params: ActivityList,
      handler: (p) =>
        activityList(ctx(), {
          automationIds: p.automationIds,
          since: p.since,
          limit: p.limit ?? DEFAULT_RUNS_LIMIT,
          skipQuiet: p.skipQuiet ?? false
        })
    }),
    defineMethod({
      name: 'pilot.runs.get',
      permission: 'workspace',
      params: RunGet,
      handler: (p) => runDetail(ctx(), p.runId)
    })
  ]
}
