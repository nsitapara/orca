import { PREPARATION_COMMAND_SPECS } from './preparation'
import type { CommandSpec } from '../../../../cli/args'
import { GLOBAL_FLAGS } from '../../../../cli/args'

export const INBOX_COMMAND_SPECS: CommandSpec[] = [
  ...PREPARATION_COMMAND_SPECS,
  {
    path: ['inbox', 'add'],
    summary: 'Add a card to the Inbox: a question, a flag, or a proposed action',
    usage:
      'pilot inbox add --type <question|flagged|default|action|bug|left_for_you> --title <text> [--context <text>] [--suggested <text>] [--option "<label> — <meaning>"]... [--details-file <path> | --details-bundle <path>] [--action <name> --args-json <json object>] [--preparation-file <path> | --not-prepared-key <key> --not-prepared-reason <text>] [--part <id>=<label>]... [--switch <on> --switch <off>] [--worktree <path>] [--automation <id> --item <key>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'preparation-file',
      'not-prepared-key',
      'not-prepared-reason',
      'type',
      'title',
      'context',
      'suggested',
      'option',
      'details-file',
      'details-bundle',
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
      "--details-file is markdown. --details-bundle is a Details bundle (pilotcli inbox create-details writes one) inside the Automations folder; Pilot reads and checks it, and its bytes join the card's digest.",
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
    path: ['inbox', 'show'],
    summary: 'One card: its type, status, version, title and where its Details are',
    usage: 'pilot inbox show --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['pilot inbox show --id in_0123456789abcdef'],
    notes: [
      'With --json, the whole card, its Details ref included (path, sha256, blocks, drafted).'
    ]
  },
  {
    path: ['inbox', 'set-details'],
    summary:
      "Replace a waiting card's Details with a bundle; its answer is cleared and it asks again",
    usage: 'pilot inbox set-details --id <id> --bundle <path> [--head <sha>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'bundle', 'head'],
    examples: [
      'pilot inbox set-details --id in_0123456789abcdef --bundle "$BUNDLE" --head 7cc153d0'
    ],
    notes: [
      "Run it from a step of a Pilot run of the card's own automation (the desktop may too): Pilot refuses any other caller.",
      'The bundle must be inside the Automations folder. --head names the commit the patch was drafted against; the cleared answer gets a reply saying so.',
      "While an answer run other than the caller is still applying the card's answer, Pilot refuses (its answer is being applied). That answer run itself may re-attach it, which clears the answer."
    ]
  },
  {
    path: ['inbox', 'answer'],
    summary:
      "Answer a card from a paired device (--host); on this Mac answers go through Pilot's Inbox",
    usage: 'pilot inbox answer --id <id> (--option <n> | --text <answer>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'option', 'text'],
    examples: [
      'pilot inbox answer --id q1 --option 1',
      'pilot inbox answer --id q1 --text "Rebase first"'
    ],
    notes: [
      'Answers on this machine go through Pilot (Inbox): the local CLI is refused. Reach a host as a paired device with --host runtime:<name>. A paired device answers questions, skips and revises; approving an action is Pilot on the Mac only.'
    ]
  }
]
