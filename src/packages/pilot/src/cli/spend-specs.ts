import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const PILOT_SPEND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'spend'],
    summary: 'Token cost of Pilot runs, by automation, skill, agent or MR',
    usage: 'pilot automations spend [--by automation|skill|agent|mr] [--days <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'by', 'days'],
    examples: ['pilot automations spend', 'pilot automations spend --by skill --days 30']
  }
]
