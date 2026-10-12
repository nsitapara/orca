import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const INBOX_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['inbox', 'add'],
    summary: 'Add a card to Waiting on you: a question, a flag, or a proposed action',
    usage:
      'pilot inbox add --type <question|flagged|default|action|bug|left_for_you> --title <text> [--context <text>] [--suggested <text>] [--option "<label> — <meaning>"]... [--details-file <path>] [--action <name> --args-json <json object>] [--part <id>=<label>]... [--switch <on> --switch <off>] [--worktree <path>] [--automation <id> --item <key>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'type',
      'title',
      'context',
      'suggested',
      'option',
      'details-file',
      'action',
      'args-json',
      'part',
      'switch',
      'worktree',
      'automation',
      'item'
    ],
    repeatableFlags: ['option', 'part', 'switch'],
    examples: [
      'pilot inbox add --type question --title "Push the fix?" --suggested Push --option "Push — publish both commits" --option "Hold — leave them local"'
    ],
    notes: [
      'Inside a step Pilot started, the card belongs to that run. Outside one, give --automation and --item.',
      'Prints the new card\'s id (with --json, {"id": …}).',
      'Never wait for the answer in your tab: Pilot brings it back.'
    ]
  },
  {
    path: ['inbox', 'list'],
    summary: 'The cards waiting on you (or on --person)',
    usage: 'pilot inbox list [--person <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'person']
  },
  {
    path: ['inbox', 'answer'],
    summary: 'Answer a card: one of its options, or your own words',
    usage: 'pilot inbox answer --id <id> (--option <n> | --text <answer>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'option', 'text'],
    examples: [
      'pilot inbox answer --id q1 --option 1',
      'pilot inbox answer --id q1 --text "Rebase first"'
    ],
    notes: [
      'Answers on this machine go through Pilot (Waiting on you): the local CLI is refused. Reach a host as a paired device with --host runtime:<name>. A paired device answers questions, skips and revises; approving an action is Pilot on the Mac only.'
    ]
  }
]
