import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ContinueRunResult } from '../../shared/api-types'
import type { PilotContext } from '../pilot-services'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { activityList, runDetail } from './run-views'

export const CONTINUE_FROM_PILOT = 'Continue runs from Pilot'

// A UI action, like Resume: only the desktop app (the transport's stamp, never a param) may start agents this way, and
// only where the run engine is.
export async function continueRunCall(
  c: Pick<PilotContext, 'schedulerOn' | 'continueRun'>,
  runId: string,
  caller: RpcCallerIdentity | undefined
): Promise<ContinueRunResult> {
  if (caller?.kind !== 'desktop') {
    throw new Error(CONTINUE_FROM_PILOT)
  }
  if (!c.schedulerOn || !c.continueRun) {
    throw new Error(SCHEDULER_OFF)
  }
  return c.continueRun(runId)
}

export const DEFAULT_RUNS_LIMIT = 100
export const MAX_RUNS_LIMIT = 300

const ActivityList = z.object({
  automationIds: z.array(z.string().min(1)).max(200).optional(),
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_RUNS_LIMIT).optional(),
  skipQuiet: z.boolean().optional()
})
const RunGet = z.object({ runId: z.string().min(1) })
const AutomationTabs = z.object({
  tabIds: z.array(z.string().min(1).max(512)).max(1000)
})

// Activity across automations and the run panel (spec §4). The reads a paired device may call too; Continue only the
// desktop app.
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
    }),
    // Activity's "Hide automation runs": the tabs among these a Pilot step ran in.
    defineMethod({
      name: 'pilot.runs.automationTabs',
      permission: 'workspace',
      params: AutomationTabs,
      handler: (p) => ({ tabIds: ctx().store.activity.automationTabs(p.tabIds) })
    }),
    defineMethod({
      name: 'pilot.runs.continue',
      permission: 'workspace',
      params: RunGet,
      handler: (p, rpc) => continueRunCall(ctx(), p.runId, rpc?.caller)
    })
  ]
}
