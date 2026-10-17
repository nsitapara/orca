import { exprPlaceholders, parseExpr } from '../expr'
import { envPlaceholders } from '../run/shell-template'
import { placeholderNames } from '../template'
import { stepNames } from './normalize'
import type { RawAutomation } from './schema'

// `step` is where the placeholder is read: null before any step runs, else the step's 0-based index.
function refError(
  name: string,
  where: string,
  step: number | null,
  names: string[]
): string | null {
  const parts = name.split('.')
  if (parts[0] !== 'steps' && parts[0] !== 'previous') {
    return null
  }
  if (step === null) {
    return `${where}: {${name}} isn't known before a run starts`
  }
  if (parts[0] === 'previous') {
    if (parts.length < 2) {
      return `${where}: {${name}} needs an output name, like {previous.changed}`
    }
    if (step === 0) {
      return `${where}: {${name}} has no previous step in the first step`
    }
    return null
  }
  if (parts.length < 3) {
    return `${where}: {${name}} needs a step and an output, like {steps.review.changed}`
  }
  const target = names.indexOf(parts[1])
  if (target === -1 || target >= step) {
    return `${where}: {${name}} doesn't name an earlier step`
  }
  return null
}

function refErrors(names: string[], where: string, step: number | null, steps: string[]): string[] {
  return names
    .map((name) => refError(name, where, step, steps))
    .filter((e): e is string => e !== null)
}

function templateErrors(
  template: string | undefined,
  where: string,
  step: number | null,
  steps: string[],
  namesOf: (template: string) => string[] = placeholderNames
): string[] {
  if (!template) {
    return []
  }
  return refErrors(namesOf(template), where, step, steps)
}

function exprErrorsAt(src: string, where: string, step: number | null, steps: string[]): string[] {
  const parsed = parseExpr(src)
  if (!parsed.ok) {
    return [`${where}: ${parsed.error}`]
  }
  return refErrors(exprPlaceholders(parsed.expr), where, step, steps)
}

// Expressions parse (contract §4), and every {steps.…}/{previous.…} names an earlier step: a typo
// would read as null when the run gets there and silently skip a step.
export function exprErrors(raw: RawAutomation): string[] {
  const steps = stepNames(raw.steps)
  const errors: string[] = []
  for (const [i, match] of (raw.items?.match ?? []).entries()) {
    errors.push(...exprErrorsAt(match, `items.match[${i}]`, null, steps))
  }
  for (const [i, c] of (raw.checks ?? []).entries()) {
    if (typeof c === 'object' && 'field' in c) {
      errors.push(...exprErrorsAt(c.field.expr, `checks[${i}].field.expr`, null, steps))
    }
  }
  const worktreeName =
    typeof raw.workspace === 'object' && 'new_worktree' in raw.workspace
      ? raw.workspace.new_worktree.name
      : undefined
  const beforeRun: [string, string | undefined][] = [
    ['once_per', raw.once_per],
    ['inbox', raw.inbox],
    ['ask_first.title', raw.ask_first?.title],
    ['ask_first.context', raw.ask_first?.context],
    ['workspace.new_worktree.name', worktreeName]
  ]
  for (const [where, template] of beforeRun) {
    errors.push(...templateErrors(template, where, null, steps))
  }
  for (const [i, s] of raw.steps.entries()) {
    if (s.when) {
      errors.push(...exprErrorsAt(s.when, `steps[${i}].when`, i, steps))
    }
    errors.push(...templateErrors(s.prompt, `steps[${i}].prompt`, i, steps))
    for (const [name, value] of Object.entries(s.env ?? {})) {
      errors.push(...templateErrors(value, `steps[${i}].env.${name}`, i, steps, envPlaceholders))
    }
  }
  return errors
}
