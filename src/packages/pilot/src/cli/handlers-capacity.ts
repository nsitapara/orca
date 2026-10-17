import type { CommandHandler } from '../../../../cli/dispatch'
import { getOptionalStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type { CapacityPayload } from '../shared/api-types-capacity'
import { MAX_RUN_LIMIT } from '../shared/capacity/limit-suggestion'
import { bindingFromEnv, invalid } from './cli-values'
import { formatCapacity } from './format-capacity'

// `none` clears the limit; anything else must be a whole number the page's picker offers.
export function parseRunLimit(text: string): number | null {
  if (text === 'none') {
    return null
  }
  const limit = /^\d+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIMIT) {
    throw invalid(`--set takes a number from 1 to ${MAX_RUN_LIMIT}, or none`)
  }
  return limit
}

export const CAPACITY_HANDLERS: Record<string, CommandHandler> = {
  // Says where it is called from: Pilot refuses a limit change from an agent in a run.
  'automations capacity': async ({ flags, client, json }) => {
    const set = getOptionalStringFlag(flags, 'set')
    const response =
      set === undefined
        ? await client.call<CapacityPayload>('pilot.capacity.get')
        : await client.call<CapacityPayload>('pilot.capacity.setLimit', {
            limit: parseRunLimit(set),
            ...bindingFromEnv(process.env)
          })
    printResult(response, json, (payload) => formatCapacity(payload, Date.now()))
  }
}
