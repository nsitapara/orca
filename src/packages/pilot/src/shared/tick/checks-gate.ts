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

const OPEN_FIELD = { automation: 'session.open_from_automation', any: 'session.open_any' } as const
const OPEN_REASON = {
  automation: 'A session from this automation is still open there',
  any: 'A session from an automation is still open there'
} as const

// `session: none_open` (M1 wording for this automation's sessions) and its `any` scope.
export function sessionOutcome(scope: 'automation' | 'any', f: ItemFields): Outcome {
  const open = f[OPEN_FIELD[scope]]
  if (typeof open !== 'boolean') {
    return { ok: false, reason: "Couldn't tell whether a session is open" }
  }
  if (open) {
    return { ok: false, reason: OPEN_REASON[scope] }
  }
  return { ok: true, reason: 'No session open' }
}

export type GateCheck = Extract<CheckDef, { kind: 'mr' | 'session_none_open' }>

export function gateCheckOutcome(c: GateCheck, f: ItemFields): Outcome {
  switch (c.kind) {
    case 'mr':
      return mrOutcome(c.rule, f)
    case 'session_none_open':
      return sessionOutcome(c.scope, f)
  }
}
