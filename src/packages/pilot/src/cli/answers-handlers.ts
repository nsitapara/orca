import type { CommandHandler } from '../../../../cli/dispatch'
import { getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type { InboxItemRow } from '../shared/api-types'

export function inboxItemLine(
  i: Pick<InboxItemRow, 'id' | 'status' | 'outcome' | 'title'>
): string {
  return [i.id, i.status, i.outcome, i.title].filter(Boolean).join(' · ')
}

export const ANSWERS_HANDLERS: Record<string, CommandHandler> = {
  'inbox tick': async ({ flags, client, json }) => {
    const params = {
      id: getRequiredStringFlag(flags, 'id'),
      outcome: getRequiredStringFlag(flags, 'outcome')
    }
    printResult(await client.call<InboxItemRow>('pilot.inbox.tick', params), json, inboxItemLine)
  },
  'inbox reply': async ({ flags, client, json }) => {
    const params = {
      id: getRequiredStringFlag(flags, 'id'),
      text: getRequiredStringFlag(flags, 'text')
    }
    printResult(await client.call<InboxItemRow>('pilot.inbox.reply', params), json, inboxItemLine)
  }
}
