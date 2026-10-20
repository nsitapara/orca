import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ContinueRunResult, StopRunResult } from '../../shared/api-types'
import type { PilotContext } from '../pilot-services'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { activityList, runDetail } from './run-views'

export const CONTINUE_FROM_PILOT = 'Continue runs from Pilot'
export const STOP_FROM_PILOT = 'Stop runs from Pilot'

type Callers = ReadonlySet<RpcCallerIdentity['kind']>
// Continue starts an agent, so it stays with the owner's desktop app; Stop only ends one, so a paired device may too.
const CONTINUE_CALLERS: Callers = new Set(['desktop'])
const STOP_CALLERS: Callers = new Set(['desktop', 'paired-device'])

// A person's action, judged by the transport's stamp (never a param), where the run engine is.
async function engineCall<T>(
  c: Pick<PilotContext, 'schedulerOn'>,
  caller: RpcCallerIdentity | undefined,
  allowed: { callers: Callers; refusal: string },
  call: ((runId: string) => Promise<T>) | undefined,
  runId: string
): Promise<T> {
  if (!caller || !allowed.callers.has(caller.kind)) {
    throw new Error(allowed.refusal)
  }
  if (!c.schedulerOn || !call) {
    throw new Error(SCHEDULER_OFF)
  }
  return call(runId)
}

export function continueRunCall(
  c: Pick<PilotContext, 'schedulerOn' | 'continueRun'>,
  runId: string,
  caller: RpcCallerIdentity | undefined
): Promise<ContinueRunResult> {
  const allowed = { callers: CONTINUE_CALLERS, refusal: CONTINUE_FROM_PILOT }
  return engineCall(c, caller, allowed, c.continueRun, runId)
}

export function stopRunCall(
  c: Pick<PilotContext, 'schedulerOn' | 'stopRun'>,
  runId: string,
  caller: RpcCallerIdentity | undefined
): Promise<StopRunResult> {
  const allowed = { callers: STOP_CALLERS, refusal: STOP_FROM_PILOT }
  return engineCall(c, caller, allowed, c.stopRun, runId)
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

// Activity across automations and the run panel (spec §4). The reads and Stop a paired device may call too; Continue
// only the desktop app.
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
    }),
    defineMethod({
      name: 'pilot.runs.stop',
      permission: 'workspace',
      params: RunGet,
      handler: (p, rpc) => stopRunCall(ctx(), p.runId, rpc?.caller)
    })
  ]
}
