import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'
import { ANSWERS_COMMAND_SPECS } from './answers-specs'
import { INBOX_COMMAND_SPECS } from './specs-inbox'
import { PILOT_SPEND_SPECS } from './spend-specs'
import { RUN_COMMAND_SPECS } from './specs-run'
import { CAPACITY_COMMAND_SPECS } from './specs-capacity'

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
  {
    path: ['automations', 'list-yaml'],
    summary: "Pilot's YAML automations, with any file that didn't load",
    usage: 'pilot automations list-yaml [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ["`pilot automations list` is Orca's own engine, which is off in Pilot."]
  },
  {
    // `show` is the CLI's read verb, but `automations show` is Orca's own engine (C1): Pilot's is
    // show-yaml, beside list-yaml, and `automations get` still reaches it.
    path: ['automations', 'show-yaml'],
    aliases: [['automations', 'get']],
    summary: 'One YAML automation: its schedule, status, checks and file',
    usage: 'pilot automations show-yaml --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['pilot automations show-yaml --id fix-failed-ci']
  },
  {
    path: ['automations', 'reload'],
    summary: 'Read the automation folders again now',
    usage: 'pilot automations reload [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['automations', 'enable'],
    summary: "Set enabled: true in a YAML automation's file",
    usage: 'pilot automations enable --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id']
  },
  {
    path: ['automations', 'disable'],
    summary: "Set enabled: false in a YAML automation's file",
    usage: 'pilot automations disable --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id']
  },
  ...RUN_COMMAND_SPECS,
  ...CAPACITY_COMMAND_SPECS,
  ...INBOX_COMMAND_SPECS,
  ...ANSWERS_COMMAND_SPECS,
  ...PILOT_SPEND_SPECS
]
