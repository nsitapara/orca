import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import { automationSchema, type RawAutomation } from './schema'
import { oncePerErrors, quotaErrors, scheduleErrors, stepErrors } from './validate'
import type { AutomationDefinition, BuiltinCheck, ParseResult } from './types'

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.join('.')
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ')
    const noun = issue.keys.length > 1 ? 'unknown keys' : 'unknown key'
    if (!path) {
      return `${noun} ${keys}`
    }
    return `${path}: ${noun} ${keys}`
  }
  if (!path) {
    return issue.message
  }
  return `${path}: ${issue.message}`
}

// M1 scope (Global Constraints): reject what later milestones bring, naming the milestone.
function m1Limits(raw: RawAutomation): string[] {
  const errors: string[] = []
  // Without items the tick would still list every open MR, so nothing may run "once" in M1.
  if (!raw.items) {
    errors.push('items: run-once automations (no items:) arrive in M3')
  }
  if (raw.items && raw.items.kind !== 'merge_request') {
    errors.push(`items.kind: "${raw.items.kind}" arrives in M3 (M1 supports merge_request)`)
  }
  if (raw.items?.fields) {
    errors.push('items.fields: custom fields arrive in M4')
  }
  if (raw.checks?.some((c) => typeof c === 'object' && 'check' in c)) {
    errors.push('checks: precheck scripts (check:) arrive in M3')
  }
  if (raw.steps.length > 1) {
    errors.push('steps: multi-step runs arrive in M3')
  }
  raw.steps.forEach((s, i) => {
    if (s.agent === 'shell') {
      errors.push(`steps[${i}].agent: shell steps arrive in M3`)
    }
    if (s.mode) {
      errors.push(`steps[${i}].mode: skill modes arrive in M3`)
    }
    if (s.when) {
      errors.push(`steps[${i}].when: conditional steps arrive in M3`)
    }
  })
  if (raw.answers !== undefined) {
    errors.push('answers: answer routing arrives in M2')
  }
  if (raw.start === 'ask_first') {
    errors.push('start: ask_first arrives in M2')
  }
  if (raw.retry_after_failure !== undefined) {
    errors.push('retry_after_failure: arrives in M3')
  }
  return errors
}

// Platform-neutral (R1): no Node built-in imports. Same result as basename(file, extname(file)) for .yaml/.yml.
function idFromFile(file: string): string {
  return file
    .split('/')
    .pop()!
    .replace(/\.ya?ml$/, '')
}

function normalizeCheck(c: NonNullable<RawAutomation['checks']>[number]): BuiltinCheck {
  if (c === 'quota') {
    return { kind: 'quota', weekly: 90, session: 95 }
  }
  if ('worktree' in c) {
    return c.worktree === 'exists' ? { kind: 'worktree_exists' } : { kind: 'worktree_clean' }
  }
  if ('session' in c) {
    return { kind: 'session_none_open' }
  }
  if ('quota' in c) {
    return { kind: 'quota', weekly: c.quota.weekly ?? 90, session: c.quota.session ?? 95 }
  }
  throw new Error('unreachable: check scripts are rejected by m1Limits')
}

function normalize(raw: RawAutomation, file: string): AutomationDefinition {
  if (!raw.items) {
    throw new Error('unreachable: a missing items: is rejected by m1Limits')
  }
  return {
    id: idFromFile(file),
    file,
    name: raw.name,
    repo: raw.repo,
    schedule: raw.schedule,
    timezone: raw.timezone ?? 'America/Los_Angeles',
    enabled: raw.enabled ?? true,
    items: { kind: 'merge_request', where: raw.items.where ?? {} },
    firstSeen: raw.first_seen ?? 'process',
    oncePer: raw.once_per ?? null,
    checks: (raw.checks ?? []).map(normalizeCheck),
    limits: { perTick: raw.limits?.per_tick ?? null, atOnce: raw.limits?.at_once ?? null },
    steps: raw.steps.map((s, i) => ({
      name: s.name ?? `step${i + 1}`,
      agent: s.agent as 'claude' | 'codex',
      skill: s.skill ?? null,
      mode: s.mode ?? null,
      prompt: s.prompt ?? ''
    })),
    powers: raw.powers ?? [],
    inbox: raw.inbox ?? '{mr.author}'
  }
}

export function parseAutomationYaml(text: string, file: string): ParseResult {
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (error) {
    return { ok: false, errors: [`${file}: YAML error: ${(error as Error).message}`] }
  }
  const parsed = automationSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${file}: ${formatIssue(i)}`) }
  }
  const limits = [
    ...scheduleErrors(parsed.data),
    ...stepErrors(parsed.data),
    ...quotaErrors(parsed.data),
    ...oncePerErrors(parsed.data),
    ...m1Limits(parsed.data)
  ]
  if (limits.length) {
    return { ok: false, errors: limits.map((e) => `${file}: ${e}`) }
  }
  return { ok: true, definition: normalize(parsed.data, file) }
}
