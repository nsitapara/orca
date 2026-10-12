import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const PILOT_SPEND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'spend'],
    summary: 'Token cost of Pilot runs, by automation, skill, agent or MR',
    usage: 'pilot automations spend [--by automation|skill|agent|mr] [--days <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'by', 'days'],
    examples: ['pilot automations spend', 'pilot automations spend --by skill --days 30']
  },
  {
    path: ['automations', 'usage-report'],
    summary: "Write the token usage report (job 08's files) now",
    usage: 'pilot automations usage-report [--out <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'out'],
    notes: [
      "Without --out it writes job 08's folder, and only once 08 has handed it over (usage-legacy.json there)."
    ],
    examples: ['pilot automations usage-report --out /tmp/usage-check']
  }
]
