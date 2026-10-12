import { existsSync } from 'node:fs'
import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotStatus } from '../../shared/api-types'
import { isOrcaAutomationsOff } from '../orca-automations-off'
import type { PilotContext, PilotHost } from '../pilot-services'
import { setAutomationEnabled } from './automation-files'
import { activity, dryRun, getAutomation, listAutomations, tickNow, validateYaml } from './handlers'
import { buildChannelMethods } from './methods-channel'

export const PILOT_VERSION = '0.1.0'
export const DEFAULT_ACTIVITY_LIMIT = 30
export const MAX_ACTIVITY_LIMIT = 200
export const MAX_VALIDATE_BYTES = 256 * 1024

const Id = z.object({ id: z.string().min(1) })
const SetEnabled = Id.extend({ enabled: z.boolean() })
const Activity = Id.extend({
  limit: z.number().int().positive().max(MAX_ACTIVITY_LIMIT).optional()
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
      handler: (p) => activity(ctx(), p.id, p.limit ?? DEFAULT_ACTIVITY_LIMIT)
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
    defineMethod({
      name: 'pilot.automations.tickNow',
      permission: 'workspace',
      params: Id,
      handler: (p) => tickNow(ctx(), p.id)
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
      handler: (p) => setAutomationEnabled(ctx(), p.id, p.enabled)
    }),
    ...buildChannelMethods(ctx)
  ].map((m) => Object.assign(m, { pilot: true }))
}
