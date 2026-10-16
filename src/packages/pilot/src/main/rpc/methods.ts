import { existsSync } from 'node:fs'
import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotStatus } from '../../shared/api-types'
import { isOrcaAutomationsOff } from '../orca-automations-off'
import type { PilotContext, PilotHost } from '../pilot-services'
import { setAutomationEnabled } from './automation-files'
import { activity, dryRun, getAutomation, listAutomations, tickNow, validateYaml } from './handlers'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { buildActionMethods } from './methods-actions'
import { runBinding } from './run-binding'
import { buildAnswerMethods } from './methods-answers'
import { buildSpendMethods } from './methods-spend'
import { buildRunMethods } from './methods-runs'
import { buildVisibilityMethods } from './methods-visibility'
import { buildTimelineMethods } from './methods-timeline'
import { buildChannelMethods } from './methods-channel'
import { buildPreparationMethods } from './methods-preparation'
import { buildDetailsMethods } from './methods-details'
import { buildInboxMethods } from './methods-inbox'
import { buildImportMethods } from './methods-import'
import { buildLinearMethods } from './methods-linear'
import { buildPlaygroundMethods } from './methods-playground'
import { buildStepSourceMethods } from './methods-step-source'

export const PILOT_VERSION = '0.1.0'
export const DEFAULT_ACTIVITY_LIMIT = 30
export const MAX_ACTIVITY_LIMIT = 200
export const MAX_VALIDATE_BYTES = 256 * 1024

const Id = z.object({ id: z.string().min(1) })
// Where a tick or an enable comes from: the CLI's terminal handle, and the env's step as the fallback.
const CallerBinding = {
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
}
const Tick = Id.extend(CallerBinding)
const SetEnabled = Id.extend({ enabled: z.boolean(), ...CallerBinding })
const Activity = Id.extend({
  limit: z.number().int().positive().max(MAX_ACTIVITY_LIMIT).optional(),
  skipQuiet: z.boolean().optional()
})
// `file` is only a label for error messages and the id source; it is never read.
const Validate = z.object({
  yaml: z.string().max(MAX_VALIDATE_BYTES),
  file: z.string().max(260).optional()
})

// Pilot fails soft (R13): when its services didn't start there is no context, and every
// automations method says so instead of crashing on undefined.
function runningContext(host: PilotHost): PilotContext {
  if (!host.context) {
    throw new Error(`Pilot isn't running: ${host.error ?? 'it has not started yet'}`)
  }
  return host.context
}

function pilotStatus(host: PilotHost): PilotStatus {
  const times = host.context?.scheduler?.loopTimes()
  return {
    version: PILOT_VERSION,
    process: host.processKind,
    dataPath: host.dataDir,
    automationDirs: host.dirs,
    missingDirs: host.dirs.filter((d) => !existsSync(d)),
    peopleError: host.context?.loaded().peopleError ?? null,
    error: host.error,
    loopStartedAt: times?.loopStartedAt ?? null,
    lastLoopFinishedAt: times?.lastLoopFinishedAt ?? null,
    // Why processKind: orcad runs on the Electron binary too, but the hook only stops desktop/serve's engine.
    orcaAutomationsOff: host.processKind === 'main' && isOrcaAutomationsOff()
  }
}

export const NO_CALLER_CHANGE = "Pilot can't tell who is calling; nothing was changed"
export const AGENT_IN_RUN =
  "An agent in a Pilot run can't tick, enable or pause an automation; Nish does that in Pilot"

// Ticking or flipping an automation is Nish's call (R15). The transport's stamp says who calls (never a
// param): no identity is refused; the desktop and a paired device are a person. The local CLI is shared by
// Nish and every agent, so it is refused when its call is bound to a run (the step on its terminal, else
// the env's step) and, failing closed, when the env names a run that can't be resolved.
function refuseAgentCaller(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  binding: z.infer<typeof Tick>
): void {
  if (!caller) {
    throw new Error(NO_CALLER_CHANGE)
  }
  if (caller.kind !== 'local-cli') {
    return
  }
  let bound: { runId: string; stepIdx: number } | null
  try {
    bound = runBinding(c, binding)
  } catch (error) {
    throw new Error(`${AGENT_IN_RUN} (${error instanceof Error ? error.message : String(error)})`)
  }
  if (bound) {
    throw new Error(`${AGENT_IN_RUN} (run ${bound.runId}, step ${bound.stepIdx})`)
  }
}

// pilot.status works even when Pilot couldn't start. Everything else needs the running context.
export function buildPilotMethods(host: PilotHost) {
  const ctx = () => runningContext(host)
  return [
    defineMethod({
      name: 'pilot.status',
      permission: 'workspace',
      params: null,
      handler: () => pilotStatus(host)
    }),
    defineMethod({
      name: 'pilot.automations.list',
      permission: 'workspace',
      params: null,
      handler: () => listAutomations(ctx())
    }),
    defineMethod({
      name: 'pilot.automations.get',
      permission: 'workspace',
      params: Id,
      handler: (p) => getAutomation(ctx(), p.id)
    }),
    defineMethod({
      name: 'pilot.automations.activity',
      permission: 'workspace',
      params: Activity,
      handler: (p) =>
        activity(ctx(), p.id, p.limit ?? DEFAULT_ACTIVITY_LIMIT, { skipQuiet: p.skipQuiet })
    }),
    // dryRun and tickNow can run long (GitLab calls plus facts for every item): callers must use a
    // timeout of at least 120 s. They return the scheduler's result unchanged:
    // TickResult | { status: 'busy' } | { status: 'unknown' }.
    defineMethod({
      name: 'pilot.automations.dryRun',
      permission: 'workspace',
      params: Id,
      handler: (p) => dryRun(ctx(), p.id)
    }),
    // A real tick launches agents: only where the scheduler runs (its run engine and answers are there).
    defineMethod({
      name: 'pilot.automations.tickNow',
      permission: 'workspace',
      params: Tick,
      handler: (p, rpc) => {
        const c = ctx()
        refuseAgentCaller(c, rpc?.caller, p)
        if (!c.schedulerOn) {
          throw new Error(SCHEDULER_OFF)
        }
        return tickNow(c, p.id)
      }
    }),
    defineMethod({
      name: 'pilot.automations.reload',
      permission: 'workspace',
      params: null,
      handler: () => {
        const c = ctx()
        c.reload()
        return listAutomations(c)
      }
    }),
    defineMethod({
      name: 'pilot.automations.validate',
      permission: 'workspace',
      params: Validate,
      handler: (p) => {
        ctx()
        return validateYaml(p.yaml, p.file ?? 'draft.yaml')
      }
    }),
    // Edits the automation's file (enabled: true|false) and reloads. Go-live is Nish's call (R15).
    defineMethod({
      name: 'pilot.automations.setEnabled',
      permission: 'workspace',
      params: SetEnabled,
      handler: (p, rpc) => {
        const c = ctx()
        refuseAgentCaller(c, rpc?.caller, p)
        return setAutomationEnabled(c, p.id, p.enabled)
      }
    }),
    ...buildChannelMethods(ctx),
    ...buildInboxMethods(ctx),
    ...buildDetailsMethods(ctx),
    ...buildPreparationMethods(ctx),
    ...buildActionMethods(ctx),
    ...buildAnswerMethods(ctx),
    ...buildSpendMethods(ctx),
    ...buildTimelineMethods(ctx),
    ...buildRunMethods(ctx),
    ...buildVisibilityMethods(ctx),
    ...buildImportMethods(host),
    ...buildPlaygroundMethods(ctx),
    ...buildStepSourceMethods(ctx),
    ...buildLinearMethods()
  ].map((m) => Object.assign(m, { pilot: true }))
}
