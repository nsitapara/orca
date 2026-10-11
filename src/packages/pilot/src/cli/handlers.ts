import { readFileSync } from 'node:fs'
import type { CommandHandler } from '../../../../cli/dispatch'
import { getOptionalPositiveIntegerFlag, getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import { RuntimeClientError } from '../../../../cli/runtime/types'
import type { ActivityTick, PilotStatus, TickOutcome } from '../shared/api-types'
import { parseAutomationYaml } from '../shared/definition/parse'
import { formatActivity, formatDecisions, formatPilotStatus } from './format'

// tick and dry-run hit GitLab and read facts for every item, so they get far more than the
// client's 60 s default.
export const LONG_CALL_TIMEOUT_MS = 180_000

function readAutomationFile(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message
    throw new RuntimeClientError('invalid_argument', `Can't read ${file}: ${reason}`)
  }
}

export const PILOT_HANDLERS: Record<string, CommandHandler> = {
  'automations status': async ({ client, json }) => {
    printResult(await client.call<PilotStatus>('pilot.status'), json, formatPilotStatus)
  },
  // Local only: parses the file here, so it works with no app running.
  'automations validate': async ({ flags, json }) => {
    const file = getRequiredStringFlag(flags, 'file')
    const result = parseAutomationYaml(readAutomationFile(file), file)
    if (json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.ok) {
      console.log(`ok ${result.definition.id}`)
    } else {
      console.error(result.errors.join('\n'))
    }
    if (!result.ok) {
      process.exitCode = 1
    }
  },
  'automations dry-run': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const response = await client.call<TickOutcome>(
      'pilot.automations.dryRun',
      { id },
      { timeoutMs: LONG_CALL_TIMEOUT_MS }
    )
    printResult(response, json, (outcome) => formatDecisions(outcome, id))
  },
  'automations tick': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const response = await client.call<TickOutcome>(
      'pilot.automations.tickNow',
      { id },
      { timeoutMs: LONG_CALL_TIMEOUT_MS }
    )
    printResult(response, json, (outcome) => formatDecisions(outcome, id))
  },
  'automations activity': async ({ flags, client, json }) => {
    const params = {
      id: getRequiredStringFlag(flags, 'id'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    }
    printResult(
      await client.call<ActivityTick[]>('pilot.automations.activity', params),
      json,
      formatActivity
    )
  }
}
