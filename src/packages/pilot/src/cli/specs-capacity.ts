import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const CAPACITY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'capacity'],
    summary: 'What runs and waits for a slot, the run limit, and a limit suggested from memory',
    usage: 'pilot automations capacity [--set <n>|none] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'set'],
    examples: ['pilot automations capacity', 'pilot automations capacity --set 3'],
    notes: [
      'The limit counts runs of jobs with an agent step; past it, items wait in line, oldest first.',
      '--set none removes the limit. An agent in a Pilot run cannot change it.'
    ]
  }
]
