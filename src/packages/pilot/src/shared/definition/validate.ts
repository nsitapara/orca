import { isValidTimeZone, parseCron } from '../schedule/cron'
import { singleQuotedPlaceholders } from '../run/shell-template'
import { PLACEHOLDER } from '../template'
import { stepNames } from './normalize'
import type { RawAutomation, RawStep } from './schema'

export function scheduleErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  if (raw.schedule !== 'manual') {
    try {
      parseCron(raw.schedule)
    } catch (error) {
      errors.push(`schedule: ${(error as Error).message}`)
    }
  }
  if (raw.timezone && !isValidTimeZone(raw.timezone)) {
    errors.push(`timezone: "${raw.timezone}" isn't an IANA time zone`)
  }
  return errors
}

const AGENT_ONLY = ['skill', 'mode', 'prompt', 'prompt_style', 'args', 'session'] as const
const SHELL_ONLY = ['run', 'exit_codes'] as const

function keyNames(keys: readonly string[]): string {
  return keys.map((k) => `${k}:`).join(', ')
}

function sessionErrors(steps: RawStep[], names: string[], i: number): string[] {
  const session = steps[i].session
  if (typeof session !== 'object') {
    return []
  }
  const target = names.indexOf(session.continue)
  if (target === -1 || target >= i) {
    return [`step ${i + 1}: session.continue: "${session.continue}" isn't an earlier step`]
  }
  const agent = steps[target].agent
  if (agent !== steps[i].agent) {
    return [
      `step ${i + 1}: session.continue: "${session.continue}" ran ${agent}; only a ${agent} step can continue it`
    ]
  }
  return []
}

function agentStepErrors(steps: RawStep[], names: string[], i: number): string[] {
  const s = steps[i]
  const n = i + 1
  const errors: string[] = []
  const shellKeys = SHELL_ONLY.filter((k) => s[k] !== undefined)
  if (shellKeys.length > 0) {
    errors.push(`step ${n}: only shell steps use ${keyNames(shellKeys)}`)
  }
  if (!s.skill && !s.prompt) {
    errors.push(`step ${n} needs a skill or a prompt`)
  }
  if (s.mode && !s.skill) {
    errors.push(`step ${n}: mode: needs a skill`)
  }
  if (s.prompt_style === 'raw' && !s.prompt) {
    errors.push(`step ${n}: prompt_style: raw needs a prompt`)
  }
  return [...errors, ...sessionErrors(steps, names, i)]
}

function shellStepErrors(s: RawStep, n: number): string[] {
  const errors: string[] = []
  const agentKeys = AGENT_ONLY.filter((k) => s[k] !== undefined)
  if (agentKeys.length > 0) {
    errors.push(`step ${n}: shell steps don't take ${keyNames(agentKeys)}`)
  }
  if (!s.run) {
    errors.push(`step ${n}: a shell step needs run:`)
  }
  for (const name of singleQuotedPlaceholders(s.run ?? '')) {
    errors.push(
      `step ${n}: {${name}} is inside single quotes in run:, where the shell can't expand it; put it outside them or in double quotes`
    )
  }
  const skip = new Set(s.exit_codes?.skip ?? [])
  for (const code of s.exit_codes?.ok ?? [0]) {
    if (skip.has(code)) {
      errors.push(`step ${n}: exit code ${code} is both ok and skip`)
    }
  }
  return errors
}

export function stepErrors(raw: RawAutomation): string[] {
  const names = stepNames(raw.steps)
  const errors = raw.steps.flatMap((s, i) => {
    if (s.agent === 'shell') {
      return shellStepErrors(s, i + 1)
    }
    return agentStepErrors(raw.steps, names, i)
  })
  const repeated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))]
  return [...errors, ...repeated.map((name) => `steps: more than one step is named "${name}"`)]
}

export function quotaErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  raw.checks?.forEach((c, i) => {
    if (typeof c !== 'object' || !('quota' in c)) {
      return
    }
    for (const field of ['weekly', 'session'] as const) {
      const value = c.quota[field]
      if (value !== undefined && !(value >= 0 && value <= 100)) {
        errors.push(`checks[${i}].quota.${field}: ${value} is out of range 0-100`)
      }
    }
  })
  return errors
}

// A constant key would make the automation run once, ever.
export function oncePerErrors(raw: RawAutomation): string[] {
  const template = raw.once_per
  if (template === undefined) {
    return []
  }
  // Any brace group with whitespace would stay literal in the key (a silent partial key).
  const spaced = /\{[^{}]*\s[^{}]*\}/.test(template)
  if (template.match(PLACEHOLDER) && !spaced) {
    return []
  }
  return ['once_per: no {field} placeholder (write {mr.iid}, without spaces)']
}

// Keys that only make sense together, or not at all without items:.
export function combinationErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  if (!raw.items && raw.workspace === 'item_worktree') {
    errors.push(
      'workspace: item_worktree needs items: (a run-once automation uses main_checkout or new_worktree)'
    )
  }
  if (!raw.items && raw.first_seen === 'baseline') {
    errors.push('first_seen: baseline needs items:')
  }
  if (!raw.items && !raw.once_per && raw.retry_after_failure !== undefined) {
    errors.push(
      'retry_after_failure: a run-once automation without once_per: runs every tick, so it has nothing to retry'
    )
  }
  if (raw.start === 'ask_first' && !raw.ask_first) {
    errors.push('ask_first: start: ask_first needs ask_first: { title: … }')
  }
  if (raw.ask_first && raw.start !== 'ask_first') {
    errors.push('ask_first: only used with start: ask_first')
  }
  if (raw.answers?.else?.mode && !raw.answers.else.skill) {
    errors.push('answers.else: mode: needs a skill')
  }
  return errors
}

function isTime(hhmm: string): boolean {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours <= 23 && minutes <= 59
}

// "HH:MM-HH:MM" in the automation's timezone; a window may cross midnight ("22:00-02:00").
export function windowErrors(raw: RawAutomation): string[] {
  return (raw.checks ?? []).flatMap((c, i) => {
    if (typeof c !== 'object' || !('window' in c)) {
      return []
    }
    const [start, end] = c.window.split('-')
    const bad = [start, end].filter((t) => !isTime(t))
    if (bad.length > 0) {
      return bad.map((t) => `checks[${i}].window: "${t}" isn't a time between 00:00 and 23:59`)
    }
    if (start === end) {
      return [`checks[${i}].window: starts and ends at the same time`]
    }
    return []
  })
}

const FIELD_NAME = /^[a-z_][a-z0-9_]*$/

export function fieldNameErrors(raw: RawAutomation): string[] {
  return Object.keys(raw.items?.fields ?? {})
    .filter((name) => !FIELD_NAME.test(name))
    .map(
      (name) =>
        `items.fields: "${name}" isn't a field name (lower-case letters, digits and _, starting with a letter or _)`
    )
}

// Everything a file that fits the schema can still get wrong, in the order it is reported.
export function definitionErrors(raw: RawAutomation): string[] {
  return [
    ...scheduleErrors(raw),
    ...stepErrors(raw),
    ...quotaErrors(raw),
    ...oncePerErrors(raw),
    ...combinationErrors(raw),
    ...windowErrors(raw),
    ...fieldNameErrors(raw)
  ]
}
