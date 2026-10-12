import type { CheckOutcome, FieldValue, ItemFields } from '../api-types'
import type { AgentKind, CheckDef } from '../definition/types'
import { evalExpr, parseExpr } from '../expr'
import { localTimeOfDay } from '../schedule/cron'

export type CheckResult = { ok: boolean; reason: string }
export type CheckContext = { label: string; fields: ItemFields; now: number; timeZone: string }
type MrRule = Extract<CheckDef, { kind: 'mr' }>['rule']

const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const MR_RULE_NAME: Record<MrRule, string> = {
  not_approved: 'Not approved',
  not_merged: 'Not merged',
  mine: 'Mine',
  not_draft: 'Not draft'
}

function scriptFileName(run: string): string {
  const first = run.trim().split(/\s+/)[0] ?? run
  return first.split('/').at(-1) ?? first
}

export function checkName(c: CheckDef): string {
  switch (c.kind) {
    case 'worktree_exists':
      return 'Worktree'
    case 'worktree_clean':
      return 'Clean'
    case 'worktree_idle':
      return 'Idle'
    case 'session_none_open':
      return c.scope === 'any' ? 'No open session (any)' : 'No open session'
    case 'quota':
      return c.agent === 'claude' ? 'Quota' : `${AGENT_NAME[c.agent]} quota`
    case 'mr':
      return MR_RULE_NAME[c.rule]
    case 'window':
      return `Window ${c.start}-${c.end}`
    case 'answers_none_pending':
      return 'No pending answers'
    case 'field':
      return c.expr
    case 'script':
      return `Check ${scriptFileName(c.run)}`
  }
}

// Expressions read item fields; a missing field is null (contract §4).
export function fieldLookup(fields: ItemFields): (name: string) => FieldValue {
  return (name) => (Object.hasOwn(fields, name) ? fields[name] : null)
}

const pass = (reason: string): CheckResult => ({ ok: true, reason })
const fail = (reason: string): CheckResult => ({ ok: false, reason })

function plural(n: number, word: string): string {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function exists(ctx: CheckContext): CheckResult {
  const path = ctx.fields['worktree.path']
  if (typeof path === 'string' && path !== '') {
    return pass(path)
  }
  const branch = ctx.fields['mr.branch']
  if (typeof branch === 'string') {
    return fail(`No worktree for branch ${branch}`)
  }
  return fail(`No worktree for ${ctx.label}`)
}

function clean(f: ItemFields): CheckResult {
  const op = f['worktree.git_operation']
  if (op !== null && typeof op !== 'string') {
    return fail("Couldn't tell whether a git operation is in progress")
  }
  if (op) {
    return fail(`A ${op} is in progress`)
  }
  const dirty = asNumber(f['worktree.dirty_count'])
  if (dirty === null) {
    return fail("Couldn't read uncommitted changes")
  }
  if (dirty > 0) {
    return fail(plural(dirty, 'uncommitted file'))
  }
  const untracked = asNumber(f['worktree.untracked_count'])
  if (untracked === null) {
    return fail("Couldn't read untracked files")
  }
  if (untracked > 0) {
    return fail(plural(untracked, 'untracked file'))
  }
  return pass('No uncommitted changes')
}

function idle(f: ItemFields): CheckResult {
  const typing = f['worktree.typing']
  if (typing === true) {
    return fail('Someone is typing in an agent tab there')
  }
  if (typing !== false) {
    return fail("Couldn't tell whether someone is typing there")
  }
  const state = f['worktree.agent_state']
  if (state === 'working') {
    return fail('An agent is working there')
  }
  if (state === 'waiting') {
    return fail('An agent there is waiting for input')
  }
  if (state !== 'idle') {
    return fail("Couldn't read the agents' state there")
  }
  return pass('No agent working and nobody typing')
}

function sessions(c: Extract<CheckDef, { kind: 'session_none_open' }>, f: ItemFields): CheckResult {
  const open = c.scope === 'any' ? f['session.open_any'] : f['session.open_from_automation']
  if (typeof open !== 'boolean') {
    return fail("Couldn't tell whether a session is open")
  }
  if (!open) {
    return pass('No session open')
  }
  if (c.scope === 'any') {
    return fail('A session from an automation is still open there')
  }
  return fail('A session from this automation is still open there')
}

// Same rule as worktree-gate's quota.py: an unreadable quota lets the run start (fail-open).
function quota(c: Extract<CheckDef, { kind: 'quota' }>, f: ItemFields): CheckResult {
  const name = AGENT_NAME[c.agent]
  const weekly = asNumber(f[`quota.${c.agent}.weekly_pct`])
  const session = asNumber(f[`quota.${c.agent}.session_pct`])
  if (weekly === null && session === null) {
    return pass(`${name} quota couldn't be read, so it runs`)
  }
  if (weekly !== null && weekly >= c.weekly) {
    return fail(`${name} is at ${weekly}% of its weekly limit (stops at ${c.weekly}%)`)
  }
  if (session !== null && session >= c.session) {
    return fail(`${name} is at ${session}% of its session limit (stops at ${c.session}%)`)
  }
  return pass(`${name} at ${weekly ?? '?'}% weekly, ${session ?? '?'}% session`)
}

function mrRef(f: ItemFields): string {
  const iid = f['mr.iid']
  return iid === undefined || iid === null ? 'the MR' : `!${iid}`
}

function mr(rule: MrRule, f: ItemFields): CheckResult {
  const ref = mrRef(f)
  if (rule === 'not_merged') {
    const state = f['mr.state']
    if (state === 'merged' || state === 'closed') {
      return fail(`${ref} is ${state}`)
    }
    return typeof state === 'string'
      ? pass(`${ref} is ${state}`)
      : fail(`Couldn't read ${ref}'s state`)
  }
  if (rule === 'not_approved') {
    return yesNo(
      f['mr.approved'],
      fail(`${ref} is approved`),
      pass(`${ref} isn't approved`),
      `Couldn't tell whether ${ref} is approved`
    )
  }
  if (rule === 'mine') {
    const author = f['mr.author'] ?? 'unknown'
    return yesNo(
      f['mr.mine'],
      pass(`${ref} is yours`),
      fail(`${ref} isn't yours (author ${author})`),
      `Couldn't tell whose MR ${ref} is`
    )
  }
  return yesNo(
    f['mr.draft'],
    fail(`${ref} is a draft`),
    pass(`${ref} isn't a draft`),
    `Couldn't tell whether ${ref} is a draft`
  )
}

function yesNo(
  value: FieldValue | undefined,
  ifTrue: CheckResult,
  ifFalse: CheckResult,
  unknown: string
): CheckResult {
  if (value === true) {
    return ifTrue
  }
  if (value === false) {
    return ifFalse
  }
  return fail(unknown)
}

function windowCheck(c: Extract<CheckDef, { kind: 'window' }>, ctx: CheckContext): CheckResult {
  const now = localTimeOfDay(ctx.now, ctx.timeZone)
  const wraps = c.start > c.end
  const inside = wraps ? now >= c.start || now <= c.end : now >= c.start && now <= c.end
  const span = `${c.start}-${c.end} (now ${now})`
  return inside ? pass(`Inside ${span}`) : fail(`Outside ${span}`)
}

// H1: an answer on this item saved but not yet dispatched (apply.py's meaning). An unanswered card doesn't block.
function answers(f: ItemFields): CheckResult {
  const waiting = asNumber(f['inbox.pending_answers'])
  if (waiting === null) {
    return fail("Couldn't read this automation's waiting answers")
  }
  if (waiting > 0) {
    return fail(`${plural(waiting, 'answer')} waiting to be applied`)
  }
  return pass('No answers waiting to be applied')
}

function fieldCheck(c: Extract<CheckDef, { kind: 'field' }>, f: ItemFields): CheckResult {
  const parsed = parseExpr(c.expr)
  if (!parsed.ok) {
    return fail(`Invalid expression "${c.expr}": ${parsed.error}`)
  }
  return evalExpr(parsed.expr, fieldLookup(f)) ? pass(`${c.expr} holds`) : fail(c.reason)
}

function outcome(c: CheckDef, ctx: CheckContext, script: CheckResult | undefined): CheckResult {
  switch (c.kind) {
    case 'worktree_exists':
      return exists(ctx)
    case 'worktree_clean':
      return clean(ctx.fields)
    case 'worktree_idle':
      return idle(ctx.fields)
    case 'session_none_open':
      return sessions(c, ctx.fields)
    case 'quota':
      return quota(c, ctx.fields)
    case 'mr':
      return mr(c.rule, ctx.fields)
    case 'window':
      return windowCheck(c, ctx)
    case 'answers_none_pending':
      return answers(ctx.fields)
    case 'field':
      return fieldCheck(c, ctx.fields)
    case 'script':
      return script ?? fail("The check script didn't run")
  }
}

// A script check's result is computed by the tick runner before the decision (Task 6b).
export function evaluateCheck(c: CheckDef, ctx: CheckContext, script?: CheckResult): CheckOutcome {
  return { check: checkName(c), ...outcome(c, ctx, script) }
}
