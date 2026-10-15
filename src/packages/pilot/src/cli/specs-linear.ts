import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

// Linear verbs upstream Orca's CLI lacks, under its `linear` command.
export const LINEAR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['linear', 'comment', 'edit'],
    summary: 'Edit a comment on a Linear issue',
    usage:
      'orca linear comment edit [<id>] [--current] --comment <commentId> (--body <text> | --body-file <path|->) [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'comment', 'body', 'body-file', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca linear comment edit ENG-123 --comment <commentId> --body "Fixed in the linked MR."',
      'orca linear comment edit --current --comment <commentId> --body-file - --json'
    ],
    notes: [
      'Replaces the whole comment body. The comment must be on the given issue (invalid_argument otherwise); Linear only lets you edit comments you wrote.',
      'Take the comment id from `orca linear comment add` or `orca linear issue <id> --comments --json`.',
      'Use --body-file - to read multiline comment bodies from stdin.'
    ]
  }
]
