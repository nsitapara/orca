import type { CheckOutcome, ItemFields } from '../api-types'
import type { CheckDef } from '../definition/types'

type Outcome = Omit<CheckOutcome, 'check'>
export type MrRule = Extract<CheckDef, { kind: 'mr' }>['rule']

// The branch fact each rule reads (Task 14b's gate fields: '' = no block, text = gate.py's reason).
const MR_FIELD: Record<MrRule, string> = {
  not_approved: 'mr.review_block',
  not_merged: 'mr.finished_block',
  mine: 'mr.owner_block',
  not_draft: 'mr.draft_block'
}
const MR_OK: Record<MrRule, string> = {
  not_approved: 'Mine, not merged or closed, and not approved',
  not_merged: 'Not merged or closed',
  mine: 'Mine (or no MR yet)',
  not_draft: 'Not a draft'
}

// gate.py's ownership rules as checks (spec §6 "Ownership rules always apply"): not_approved is
// review_block, which also holds mr_block and owner_block; not_merged is mr_block; mine is owner_block.
// No branch facts (a pipeline item) fails closed, as gate.py does when GitLab can't say.
export function mrOutcome(rule: MrRule, f: ItemFields): Outcome {
  const field = MR_FIELD[rule] as string | undefined
  if (field === undefined) {
    return { ok: false, reason: `Unknown merge request rule "${String(rule)}"` }
  }
  const block = f[field]
  if (typeof block !== 'string') {
    return { ok: false, reason: "Couldn't read the branch's merge requests" }
  }
  if (block !== '') {
    return { ok: false, reason: block }
  }
  return { ok: true, reason: MR_OK[rule] }
}

export type GateCheck = Extract<CheckDef, { kind: 'mr' }>

// Task 6a's `evaluateCheck` sends the gate-backed kinds here. Task 19b adds `worktree_idle` and
// `session_none_open`.
export function gateCheckOutcome(c: GateCheck, f: ItemFields): Outcome {
  return mrOutcome(c.rule, f)
}
