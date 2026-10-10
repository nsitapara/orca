import type { CommandHandler } from '../../../../cli/dispatch'
import { printResult } from '../../../../cli/format'
import type { PilotStatus } from '../shared/api-types'
import { formatPilotStatus } from './format'

export const PILOT_HANDLERS: Record<string, CommandHandler> = {
  'automations status': async ({ client, json }) => {
    printResult(await client.call<PilotStatus>('pilot.status'), json, formatPilotStatus)
  }
}
