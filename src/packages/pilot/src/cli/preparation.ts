import { resolve } from 'node:path'
import type { CommandHandler } from '../../../../cli/dispatch'
import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'
import { getRequiredStringFlag, getOptionalPositiveIntegerFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type { InboxItemRow } from '../shared/api-types'
import { bindingFromEnv, invalid } from './cli-values'

const COMMANDS = [
  { command: 'claim', rpc: 'prepareClaim', flags: [] },
  { command: 'progress', rpc: 'prepareProgress', flags: ['attempt', 'message'] },
  { command: 'complete', rpc: 'prepareComplete', flags: ['attempt', 'details-bundle'] },
  { command: 'fail', rpc: 'prepareFail', flags: ['attempt', 'error', 'retry'] }
] as const

export const PREPARATION_COMMAND_KEYS = COMMANDS.map((c) => `inbox prepare-${c.command}`)
export const PREPARATION_COMMAND_SPECS: CommandSpec[] = COMMANDS.map((c) => ({
  path: ['inbox', `prepare-${c.command}`],
  summary: `${c.command} an inbox context preparation attempt`,
  usage: `pilot inbox prepare-${c.command} --id <id> --revision <n> ${c.flags.map((f) => `--${f} <value>`).join(' ')} [--json]`,
  allowedFlags: [...GLOBAL_FLAGS, 'id', 'revision', ...c.flags]
}))

export const PREPARATION_HANDLERS: Record<string, CommandHandler> = Object.fromEntries(
  COMMANDS.map((c) => [
    `inbox prepare-${c.command}`,
    async ({ flags, client, json }: Parameters<CommandHandler>[0]) => {
      const revision = getOptionalPositiveIntegerFlag(flags, 'revision')
      if (revision === undefined) {
        throw invalid('--revision is required')
      }
      const params: Record<string, unknown> = {
        id: getRequiredStringFlag(flags, 'id'),
        revision,
        ...bindingFromEnv(process.env)
      }
      if (c.command !== 'claim') {
        const attempt = getOptionalPositiveIntegerFlag(flags, 'attempt')
        if (attempt === undefined) {
          throw invalid('--attempt is required')
        }
        params.attempt = attempt
      }
      if (c.command === 'progress') {
        params.message = getRequiredStringFlag(flags, 'message')
      }
      if (c.command === 'complete') {
        params.bundlePath = resolve(process.cwd(), getRequiredStringFlag(flags, 'details-bundle'))
      }
      if (c.command === 'fail') {
        params.error = getRequiredStringFlag(flags, 'error')
        params.retry = flags.get('retry') === true
      }
      printResult(
        await client.call<InboxItemRow>(`pilot.inbox.${c.rpc}`, params),
        json,
        (item) => `${item.id}: ${item.preparation?.progress ?? item.status}`
      )
    }
  ])
)
