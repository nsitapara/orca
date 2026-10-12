import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

// Part E's commands: answering, the answer queue and the action catalog. Their own handler group loads
// answers-handlers.ts only when one of them runs.
export const ANSWERS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['inbox', 'tick'],
    summary: 'Close a Waiting on you card, saying what happened',
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
  }
]

export const ANSWERS_COMMAND_KEYS: readonly string[] = ANSWERS_COMMAND_SPECS.map((s) =>
  s.path.join(' ')
)
