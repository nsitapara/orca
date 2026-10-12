import type { CommandHandler } from '../../../../cli/dispatch'
import { getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import { RuntimeClientError } from '../../../../cli/runtime/types'
import type { ImportStateResult } from '../shared/api-types'
import { formatImportState } from './format-import'

export const IMPORT_HANDLERS: Record<string, CommandHandler> = {
  // `--apply` isn't one of upstream's boolean flags, so `--apply <word>` would arrive as a value: refuse it.
  'automations import-state': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const apply = flags.get('apply')
    if (typeof apply === 'string') {
      throw new RuntimeClientError('invalid_argument', '--apply takes no value')
    }
    printResult(
      await client.call<ImportStateResult>('pilot.automations.importState', {
        id,
        apply: apply === true
      }),
      json,
      formatImportState
    )
  }
}
