import type { CheckOutcome, ItemFields } from '../api-types'
import type { BuiltinCheck } from '../definition/types'

const NAMES: Record<BuiltinCheck['kind'], string> = {
  worktree_exists: 'Worktree',
  worktree_clean: 'Clean',
  session_none_open: 'No open session',
  quota: 'Quota'
}

export function checkName(c: BuiltinCheck): string {
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
  c: Extract<BuiltinCheck, { kind: 'quota' }>,
  f: ItemFields
): Omit<CheckOutcome, 'check'> {
  const weekly = asNumber(f['quota.claude.weekly_pct'])
  const session = asNumber(f['quota.claude.session_pct'])
  if (weekly === null && session === null) {
    return { ok: true, reason: "Claude quota couldn't be read, so it runs" }
  }
  if (weekly !== null && weekly >= c.weekly) {
    return {
      ok: false,
      reason: `Claude is at ${weekly}% of its weekly limit (stops at ${c.weekly}%)`
    }
  }
  if (session !== null && session >= c.session) {
    return {
      ok: false,
      reason: `Claude is at ${session}% of its session limit (stops at ${c.session}%)`
    }
  }
  return { ok: true, reason: `Claude at ${weekly ?? '?'}% weekly, ${session ?? '?'}% session` }
}

function outcome(c: BuiltinCheck, f: ItemFields): Omit<CheckOutcome, 'check'> {
  if (c.kind === 'worktree_exists') {
    const path = f['worktree.path']
    if (typeof path !== 'string') {
      return { ok: false, reason: `No worktree for branch ${f['mr.branch'] ?? '(unknown)'}` }
    }
    return { ok: true, reason: path }
  }
  if (c.kind === 'worktree_clean') {
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
  if (c.kind === 'session_none_open') {
    const open = f['session.open_from_automation']
    if (typeof open !== 'boolean') {
      return { ok: false, reason: "Couldn't tell whether a session is open" }
    }
    if (open) {
      return { ok: false, reason: 'A session from this automation is still open there' }
    }
    return { ok: true, reason: 'No session open' }
  }
  return quotaOutcome(c, f)
}

export function evaluateCheck(c: BuiltinCheck, f: ItemFields): CheckOutcome {
  return { check: checkName(c), ...outcome(c, f) }
}
