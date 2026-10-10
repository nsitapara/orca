import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const PILOT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'status'],
    summary: 'Show Pilot: version, data folder and automation folders',
    usage: 'pilot automations status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['pilot automations status', 'pilot automations status --json']
  }
]
