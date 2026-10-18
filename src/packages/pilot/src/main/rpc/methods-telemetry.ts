import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { TELEMETRY_WINDOWS } from '../../shared/api-types-telemetry'
import { pilotcliRunner } from '../envs/pilotcli'
import type { PilotContext } from '../pilot-services'
import { telemetryService, type TelemetryService } from '../telemetry/telemetry'

// A command name as pilotcli prints it: the condition Pilot passes on can hold nothing else.
const COMMAND = /^[a-z]+ [a-z]+(?:-[a-z]+)*$/

export const TelemetryGet = z.object({
  since: z.enum(TELEMETRY_WINDOWS),
  includeDev: z.boolean(),
  command: z.string().max(80).regex(COMMAND).optional()
})

// pilotcli's telemetry on this Mac (main/telemetry), for the Playground's Telemetry tab. Read only: any caller may
// read it (the desktop, the browser version, a paired device); it holds ids, names and counts, never content.
export function buildTelemetryMethods(
  ctx: () => Pick<PilotContext, 'engineEnv'>,
  make: (pilotBinDir: string) => TelemetryService = (dir) =>
    telemetryService({ pilotcli: pilotcliRunner({ pilotBinDir: dir }) })
) {
  let service: TelemetryService | null = null
  return [
    defineMethod({
      name: 'pilot.telemetry.get',
      permission: 'workspace',
      params: TelemetryGet,
      handler: (p) => {
        service ??= make(ctx().engineEnv?.binDir ?? '')
        return service.get(p)
      }
    })
  ]
}
