import type { FieldValue, ItemFields, RunStatus, StepStatus } from '../api-types'
import type { StepDef } from '../definition/types'
import { evalExpr, exprPlaceholders, parseExpr } from '../expr'

// A step that has ended, as the run engine sees it. `always` comes from the definition.
export type EndedStep = { name: string; status: StepStatus; always: boolean; error: string | null }
export type StepVerdict = { run: true } | { run: false; reason: string }
export type RunEnd = {
  status: Extract<RunStatus, 'done' | 'failed' | 'timed_out' | 'needs_you'>
  outcome: string
}

function broke(step: EndedStep): boolean {
  return step.status === 'failed' || step.status === 'timed_out'
}

function brokenReason(step: EndedStep): string {
  if (step.status === 'timed_out') {
    return `Step ${step.name} timed out`
  }
  return `Step ${step.name} failed`
}

function lookupIn(fields: ItemFields): (name: string) => FieldValue {
  return (name) => (Object.hasOwn(fields, name) ? fields[name] : null)
}

function falseWhen(when: string, missing: string[]): StepVerdict {
  if (missing.length === 0) {
    return { run: false, reason: `when: ${when} is false` }
  }
  const names = missing.map((name) => `{${name}}`).join(', ')
  return { run: false, reason: `when: ${when} is false (no value for ${names})` }
}

// Two gates, both must pass. (a) An earlier non-`always` step that failed or timed out skips every
// later non-`always` step; skipped steps count as success. (b) `when`, when set, must be true.
// `always` lifts gate (a) only.
export function decideStep(
  step: Pick<StepDef, 'when' | 'always'>,
  earlier: EndedStep[],
  fields: ItemFields
): StepVerdict {
  if (!step.always) {
    const broken = earlier.find((s) => !s.always && broke(s))
    if (broken) {
      return { run: false, reason: brokenReason(broken) }
    }
  }
  if (step.when === null) {
    return { run: true }
  }
  const parsed = parseExpr(step.when)
  if (!parsed.ok) {
    return { run: false, reason: `when: ${parsed.error}` }
  }
  const lookup = lookupIn(fields)
  if (evalExpr(parsed.expr, lookup)) {
    return { run: true }
  }
  return falseWhen(
    step.when,
    exprPlaceholders(parsed.expr).filter((name) => lookup(name) === null)
  )
}

function plural(n: number, word: string): string {
  if (n === 1) {
    return `${n} ${word}`
  }
  return `${n} ${word}s`
}

function failedOutcome(step: EndedStep): string {
  if (step.error) {
    return `Step ${step.name} failed: ${step.error}`
  }
  return `Step ${step.name} failed`
}

function cleanupVerb(step: EndedStep): string {
  if (step.status === 'timed_out') {
    return 'timed out'
  }
  return 'failed'
}

// failed > timed_out > needs_you > done. Only non-`always` steps decide failed/timed_out: a cleanup
// step that broke is named in a done run's outcome. A plain done run keeps the outcome "Done".
export function runEnd(steps: EndedStep[], openInboxItems: number): RunEnd {
  const main = steps.filter((s) => !s.always)
  const failed = main.find((s) => s.status === 'failed')
  if (failed) {
    return { status: 'failed', outcome: failedOutcome(failed) }
  }
  const timedOut = main.find((s) => s.status === 'timed_out')
  if (timedOut) {
    return { status: 'timed_out', outcome: `Step ${timedOut.name} timed out` }
  }
  if (openInboxItems > 0) {
    return {
      status: 'needs_you',
      outcome: `Inbox: ${plural(openInboxItems, 'open item')}`
    }
  }
  const cleanup = steps.find((s) => s.always && broke(s))
  if (cleanup) {
    return { status: 'done', outcome: `Done; cleanup step ${cleanup.name} ${cleanupVerb(cleanup)}` }
  }
  if (steps.length > 0 && steps.every((s) => s.status === 'skipped')) {
    return { status: 'done', outcome: 'Done: every step was skipped' }
  }
  return { status: 'done', outcome: 'Done' }
}
