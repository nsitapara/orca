import type { CommandHandler } from '../../../../cli/dispatch'
import { getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type {
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary
} from '../shared/api-types'
import { bindingFromEnv } from './cli-values'
import { formatAutomationDetail, formatAutomationList } from './format-automations'

// Says where it is called from: Pilot refuses enable/disable from an agent in a run.
function setEnabled(enabled: boolean): CommandHandler {
  return async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const response = await client.call<AutomationSummary>('pilot.automations.setEnabled', {
      id,
      enabled,
      ...bindingFromEnv(process.env)
    })
    printResult(response, json, (a) => `${a.enabled ? 'Enabled' : 'Paused'} ${a.id} (${a.file})`)
  }
}

// Pilot's YAML automations. `list-yaml`, because upstream's `automations list` is Orca's own engine.
export const AUTOMATION_FILE_HANDLERS: Record<string, CommandHandler> = {
  'automations list-yaml': async ({ client, json }) => {
    printResult(
      await client.call<AutomationListPayload>('pilot.automations.list'),
      json,
      formatAutomationList
    )
  },
  'automations show-yaml': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    printResult(
      await client.call<AutomationDetailPayload>('pilot.automations.get', { id }),
      json,
      formatAutomationDetail
    )
  },
  'automations reload': async ({ client, json }) => {
    printResult(
      await client.call<AutomationListPayload>('pilot.automations.reload'),
      json,
      formatAutomationList
    )
  },
  'automations enable': setEnabled(true),
  'automations disable': setEnabled(false)
}
