import type { ItemDecision, Verdict } from '../../src/shared/api-types'
import type { OldDecision } from './old-side'

// Each old decision word maps to the verdicts that agree with it (the table lives with each job).
// `rows` split a word by its reason (the first row that matches wins over `map`); `known` names a
// difference the port makes on purpose, so it is explained rather than reported.
export type VerdictRow = { word: string; reason?: RegExp; verdicts: readonly Verdict[] }
export type KnownDifference = {
  key: string
  word: string
  verdict: Verdict | 'absent'
  why: string
}
export type VerdictTable = {
  map: Record<string, readonly Verdict[]>
  whenOldMissing: readonly Verdict[]
  rows?: VerdictRow[]
  known?: KnownDifference[]
}
export type Mismatch = { key: string; old: string; fresh: string }

const NOT_LISTED = '(not listed)'

function describeOld(d: OldDecision | undefined): string {
  if (!d) {
    return NOT_LISTED
  }
  if (!d.reason) {
    return d.decision
  }
  return `${d.decision}: ${d.reason}`
}

function describeNew(d: ItemDecision | undefined): string {
  if (!d) {
    return NOT_LISTED
  }
  if (!d.reason) {
    return d.verdict
  }
  return `${d.verdict}: ${d.reason}`
}

function allowedVerdicts(
  o: OldDecision | undefined,
  table: VerdictTable
): readonly Verdict[] | undefined {
  if (!o) {
    return table.whenOldMissing
  }
  const row = table.rows?.find(
    (r) => r.word === o.decision && (r.reason === undefined || r.reason.test(o.reason))
  )
  return row ? row.verdicts : table.map[o.decision]
}

function agrees(o: OldDecision | undefined, n: ItemDecision, table: VerdictTable): boolean {
  const allowed = allowedVerdicts(o, table)
  return allowed !== undefined && allowed.includes(n.verdict)
}

function isKnown(
  key: string,
  o: OldDecision | undefined,
  n: ItemDecision | undefined,
  table: VerdictTable
): boolean {
  const word = o ? o.decision : NOT_LISTED
  const verdict = n ? n.verdict : 'absent'
  return (table.known ?? []).some((k) => k.key === key && k.word === word && k.verdict === verdict)
}

// Verdicts must agree item by item; reasons are shown, not compared ("the same in substance" is for people).
export function compareDecisions(
  old: OldDecision[],
  fresh: ItemDecision[],
  table: VerdictTable
): Mismatch[] {
  const olds = new Map(old.map((d) => [d.key, d]))
  const news = new Map(fresh.map((d) => [d.key, d]))
  const keys = [...new Set([...olds.keys(), ...news.keys()])].sort()
  const out: Mismatch[] = []
  for (const key of keys) {
    const o = olds.get(key)
    const n = news.get(key)
    const same = n !== undefined && agrees(o, n, table)
    if (!same && !isKnown(key, o, n, table)) {
      out.push({ key, old: describeOld(o), fresh: describeNew(n) })
    }
  }
  return out
}

export function formatMismatches(mismatches: Mismatch[]): string {
  return mismatches.map((m) => `${m.key}: old ${m.old} | new ${m.fresh}`).join('\n')
}
