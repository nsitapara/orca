import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'
import { RUN_COMMAND_SPECS } from './specs-run'

export const PILOT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'status'],
    summary: 'Show Pilot: version, data folder and automation folders',
    usage: 'pilot automations status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['pilot automations status', 'pilot automations status --json']
  },
  {
    path: ['automations', 'validate'],
    summary: 'Check a Pilot automation file without saving or running it',
    usage: 'pilot automations validate --file <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file'],
    examples: ['pilot automations validate --file ~/.agents/automations/fix-failed-ci.yaml']
  },
  {
    path: ['automations', 'dry-run'],
    summary: 'Check every item now and show what would start; nothing starts',
    usage: 'pilot automations dry-run --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['pilot automations dry-run --id fix-failed-ci']
  },
  {
    path: ['automations', 'tick'],
    summary: 'Run one tick now (starts runs on items that pass)',
    usage: 'pilot automations tick --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['pilot automations tick --id fix-failed-ci']
  },
  {
    path: ['automations', 'activity'],
    summary: 'Recent ticks with their runs',
    usage: 'pilot automations activity --id <id> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'limit'],
    examples: ['pilot automations activity --id fix-failed-ci --limit 5']
  },
  ...RUN_COMMAND_SPECS
]
