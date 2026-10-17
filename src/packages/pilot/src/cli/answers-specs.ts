import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

// Part E's commands: answering, the answer queue and the action catalog. Their own handler group loads
// answers-handlers.ts only when one of them runs.
export const ANSWERS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['inbox', 'tick'],
    summary: 'Close an Inbox card, saying what happened',
    usage: 'pilot inbox tick --id <id> --outcome <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'outcome'],
    examples: ['pilot inbox tick --id in_0123456789abcdef --outcome "done: pushed 9c1e2f0"']
  },
  {
    path: ['inbox', 'reply'],
    summary: 'Ask about an answer under its card; the card waits on its person again',
    usage: 'pilot inbox reply --id <id> --text <question> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'text'],
    examples: ['pilot inbox reply --id in_0123456789abcdef --text "Which image: e2e or unit?"']
  },
  {
    path: ['action', 'run'],
    summary:
      "Run a catalog action from a Pilot run's step; one the run lacks the power for is asked of a person instead",
    usage: 'pilot action run --name <entry> --args-json <json object> [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'args-json', 'dry-run'],
    examples: [
      'pilot action run --name push --args-json \'{"argv":["/wt/web-1493","web-1493-a","9c1e2f0","1a2b3c4"]}\' --dry-run'
    ],
    notes: [
      "Inside a Pilot step, the step running in this terminal is the caller (PILOT_RUN_ID and PILOT_STEP_IDX are the fallback, only while that step is active); its run's powers apply. Outside a Pilot run it only dry-runs: approve actions in Pilot (Inbox).",
      'Exit codes: done 0, failed 1, stale 3, needs_agent 4, not_yet 5, asked 6.'
    ]
  },
  {
    path: ['action', 'list'],
    summary: "Pilot's action catalog: each action, the power it needs and its arguments",
    usage: 'pilot action list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['pilot action list']
  },
  {
    path: ['inbox', 'queue'],
    summary: 'Up next: every saved answer, what it sets off and why it waits',
    usage: 'pilot inbox queue [--person <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'person'],
    examples: ['pilot inbox queue --person nish']
  },
  {
    path: ['inbox', 'apply-now'],
    summary: 'Apply saved answers now, without the 180 s settle (one card, or all)',
    usage: 'pilot inbox apply-now [--id <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['pilot inbox apply-now', 'pilot inbox apply-now --id in_0123456789abcdef'],
    notes: [
      "From a terminal it hurries only answers that run no action: an approval keeps its 180 s settle unless Apply now is pressed in Pilot's app."
    ]
  }
]

export const ANSWERS_COMMAND_KEYS: readonly string[] = ANSWERS_COMMAND_SPECS.map((s) =>
  s.path.join(' ')
)
