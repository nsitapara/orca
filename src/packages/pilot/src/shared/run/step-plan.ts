import type { FieldValue, ItemFields, RunRow, RunStatus, StepStatus } from '../api-types'
import type { StepDef } from '../definition/types'
import { evalExpr, exprPlaceholders, parseExpr } from '../expr'

// A step that has ended, as the run engine sees it. `always` comes from the definition.
export type EndedStep = { name: string; status: StepStatus; always: boolean; error: string | null }
export type StepVerdict = { run: true } | { run: false; reason: string }
export type RunEnd = {
  status: Extract<RunStatus, 'done' | 'failed' | 'timed_out' | 'needs_you' | 'cancelled'>
  outcome: string
}

function broke(step: EndedStep): boolean {
  return step.status === 'failed' || step.status === 'timed_out'
}

// A step that holds back every later non-`always` step: it broke, or it stopped the run (nothing to do).
function holdsBack(step: EndedStep): boolean {
  return broke(step) || step.status === 'stopped'
}

function brokenReason(step: EndedStep): string {
  if (step.status === 'stopped') {
    return `Step ${step.name} had nothing to do`
  }
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

// Two gates, both must pass. (a) An earlier non-`always` step that failed, timed out or stopped the run
// skips every later non-`always` step; skipped steps count as success. (b) `when`, when set, must be true.
// `always` lifts gate (a) only.
export function decideStep(
  step: Pick<StepDef, 'when' | 'always'>,
  earlier: EndedStep[],
  fields: ItemFields
): StepVerdict {
  if (!step.always) {
    const broken = earlier.find((s) => !s.always && holdsBack(s))
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

export const NOTHING_TO_DO = 'Nothing to do'

function nothingToDo(step: EndedStep): string {
  if (step.error) {
    return `${NOTHING_TO_DO}: ${step.error}`
  }
  return NOTHING_TO_DO
}

// A run that ended because a step found nothing to do (runEnd's stopped outcome): no work done, nothing failed.
export function hadNothingToDo(run: Pick<RunRow, 'status' | 'outcome'>): boolean {
  return run.status === 'done' && (run.outcome?.startsWith(NOTHING_TO_DO) ?? false)
}

function cleanupNote(step: EndedStep | undefined): string {
  if (!step) {
    return ''
  }
  return `; cleanup step ${step.name} ${cleanupVerb(step)}`
}

// failed > timed_out > needs_you > stopped ("Nothing to do: <reason>") > done. Only non-`always` steps decide failed,
// timed_out or stopped: a cleanup step that broke is named in a done run's outcome. A plain done run keeps "Done".
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
  const stopped = main.find((s) => s.status === 'stopped')
  if (stopped) {
    return { status: 'done', outcome: `${nothingToDo(stopped)}${cleanupNote(cleanup)}` }
  }
  if (cleanup) {
    return { status: 'done', outcome: `Done${cleanupNote(cleanup)}` }
  }
  if (steps.length > 0 && steps.every((s) => s.status === 'skipped')) {
    return { status: 'done', outcome: 'Done: every step was skipped' }
  }
  return { status: 'done', outcome: 'Done' }
}
