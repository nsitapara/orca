import type { CheckOutcome, ItemFields } from '../api-types'
import type { AgentKind, CheckDef } from '../definition/types'

const NAMES: Record<CheckDef['kind'], string> = {
  worktree_exists: 'Worktree',
  worktree_clean: 'Clean',
  worktree_idle: 'Idle',
  session_none_open: 'No open session',
  quota: 'Quota',
  mr: 'MR',
  window: 'Window',
  answers_none_pending: 'No pending answers',
  field: 'Field',
  script: 'Script'
}
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

export function checkName(c: CheckDef): string {
  return NAMES[c.kind]
}

function plural(n: number, word: string): string {
  if (n === 1) {
    return `${n} ${word}`
  }
  return `${n} ${word}s`
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') {
    return v
  }
  return null
}

function quotaOutcome(
  c: Extract<CheckDef, { kind: 'quota' }>,
  f: ItemFields
): Omit<CheckOutcome, 'check'> {
  const who = AGENT_NAMES[c.agent]
  const weekly = asNumber(f[`quota.${c.agent}.weekly_pct`])
  const session = asNumber(f[`quota.${c.agent}.session_pct`])
  if (weekly === null && session === null) {
    return { ok: true, reason: `${who} quota couldn't be read, so it runs` }
  }
  if (weekly !== null && weekly >= c.weekly) {
    return {
      ok: false,
      reason: `${who} is at ${weekly}% of its weekly limit (stops at ${c.weekly}%)`
    }
  }
  if (session !== null && session >= c.session) {
    return {
      ok: false,
      reason: `${who} is at ${session}% of its session limit (stops at ${c.session}%)`
    }
  }
  return { ok: true, reason: `${who} at ${weekly ?? '?'}% weekly, ${session ?? '?'}% session` }
}

function worktreeExists(f: ItemFields): Omit<CheckOutcome, 'check'> {
  const path = f['worktree.path']
  if (typeof path !== 'string') {
    return { ok: false, reason: `No worktree for branch ${f['mr.branch'] ?? '(unknown)'}` }
  }
  return { ok: true, reason: path }
}

function worktreeClean(f: ItemFields): Omit<CheckOutcome, 'check'> {
  const op = f['worktree.git_operation']
  if (op !== null && typeof op !== 'string') {
    return { ok: false, reason: "Couldn't tell whether a git operation is in progress" }
  }
  if (op) {
    return { ok: false, reason: `A ${op} is in progress` }
  }
  const dirty = asNumber(f['worktree.dirty_count'])
  if (dirty === null) {
    return { ok: false, reason: "Couldn't read uncommitted changes" }
  }
  if (dirty > 0) {
    return { ok: false, reason: plural(dirty, 'uncommitted file') }
  }
  return { ok: true, reason: 'No uncommitted changes' }
}

function noSessionOpen(f: ItemFields): Omit<CheckOutcome, 'check'> {
  const open = f['session.open_from_automation']
  if (typeof open !== 'boolean') {
    return { ok: false, reason: "Couldn't tell whether a session is open" }
  }
  if (open) {
    return { ok: false, reason: 'A session from this automation is still open there' }
  }
  return { ok: true, reason: 'No session open' }
}

function outcome(c: CheckDef, f: ItemFields): Omit<CheckOutcome, 'check'> {
  if (c.kind === 'worktree_exists') {
    return worktreeExists(f)
  }
  if (c.kind === 'worktree_clean') {
    return worktreeClean(f)
  }
  if (c.kind === 'session_none_open' && c.scope === 'automation') {
    return noSessionOpen(f)
  }
  if (c.kind === 'quota') {
    return quotaOutcome(c, f)
  }
  // Task 6 evaluates the rest. Until then such a check fails, so nothing starts on a check Pilot can't read.
  return { ok: false, reason: `Pilot can't evaluate the ${checkName(c)} check yet` }
}

export function evaluateCheck(c: CheckDef, f: ItemFields): CheckOutcome {
  return { check: checkName(c), ...outcome(c, f) }
}
