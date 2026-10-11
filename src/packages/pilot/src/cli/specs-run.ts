import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const RUN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['run', 'output'],
    summary: 'Record outputs of this Pilot step; later steps read them as {steps.<step>.<key>}',
    usage: 'pilot run output <key>=<value>... [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'pair'],
    positionalArgs: ['pair'],
    variadicPositional: true,
    repeatableFlags: ['pair'],
    examples: [
      'pilot run output changed=true',
      'pilot run output found_bugs=2 report="reports/qa 1.md"'
    ],
    notes: [
      'Run it inside a step Pilot started: the step running in this terminal is the one recorded (PILOT_RUN_ID and PILOT_STEP_IDX are the fallback).',
      'A value that reads as JSON (true, 3, null) is stored as that; anything else as text.'
    ]
  },
  {
    path: ['run', 'event'],
    summary: "Record an event on this Pilot run's timeline",
    usage: 'pilot run event <kind> [--payload <json object>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'kind', 'payload'],
    positionalArgs: ['kind'],
    examples: [`pilot run event pushed --payload '{"sha":"abc1234"}'`]
  }
]
