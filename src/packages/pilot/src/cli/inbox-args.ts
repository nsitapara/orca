import type { InboxAddParams, InboxType } from '../shared/api-types'

export const INBOX_TYPES: readonly InboxType[] = [
  'question',
  'flagged',
  'default',
  'action',
  'bug',
  'left_for_you'
]
export const MAX_DETAILS_BYTES = 256 * 1024
const DASH = ' — '

export function isInboxType(value: string): value is InboxType {
  return (INBOX_TYPES as readonly string[]).includes(value)
}

// A Details bundle (an object with a numeric version and a list of blocks) given as --details-file would
// show as raw JSON on the card: it goes with --details-bundle instead.
export function isDetailsBundleText(text: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return false
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const { version, blocks } = value as { version?: unknown; blocks?: unknown }
  return typeof version === 'number' && Array.isArray(blocks)
}

// The server parses "<label> — <meaning>" (Task 20a's parseOption). The CLI only refuses an option with
// no label, so a typo fails here and not after the card is written. No dash: the whole text is the label.
export function checkInboxOption(raw: string): string {
  const at = raw.indexOf(DASH)
  const label = (at === -1 ? raw : raw.slice(0, at)).trim()
  if (label === '') {
    if (at === -1) {
      throw new Error(`--option "${raw}" has no label`)
    }
    throw new Error(`--option "${raw}" has no label before "${DASH}"`)
  }
  return raw
}

export type InboxTarget = Pick<
  InboxAddParams,
  'terminal' | 'runId' | 'stepIdx' | 'automationId' | 'itemKey'
>

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

// Inside a step Pilot started, the card belongs to the step running in the caller's terminal
// (ORCA_TERMINAL_HANDLE), falling back to PILOT_RUN_ID / PILOT_STEP_IDX (ruling 8d). Outside a
// run, --automation and --item say whose it is. Flags win over the env for those two. Absent values are
// left out of the result.
export function inboxTarget(
  env: NodeJS.ProcessEnv,
  flags: { automation?: string; item?: string }
): InboxTarget {
  const runId = envValue(env, 'PILOT_RUN_ID')
  const rawIdx = envValue(env, 'PILOT_STEP_IDX') ?? ''
  const stepIdx = runId !== undefined && /^\d+$/.test(rawIdx) ? Number(rawIdx) : undefined
  const automationId = flags.automation ?? envValue(env, 'PILOT_AUTOMATION_ID')
  const itemKey = flags.item ?? envValue(env, 'PILOT_ITEM_KEY')
  const terminal = envValue(env, 'ORCA_TERMINAL_HANDLE')
  // Inside a terminal the server resolves (or refuses) the step from the terminal itself.
  if (
    runId === undefined &&
    terminal === undefined &&
    (automationId === undefined || itemKey === undefined)
  ) {
    throw new Error('Outside a Pilot run, give --automation <id> and --item <key>')
  }
  const target: InboxTarget = {}
  if (terminal !== undefined) {
    target.terminal = terminal
  }
  if (runId !== undefined) {
    target.runId = runId
  }
  if (stepIdx !== undefined) {
    target.stepIdx = stepIdx
  }
  if (automationId !== undefined) {
    target.automationId = automationId
  }
  if (itemKey !== undefined) {
    target.itemKey = itemKey
  }
  return target
}
