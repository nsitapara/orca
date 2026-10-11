import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import { normalize } from './normalize'
import { automationSchema, type RawAutomation } from './schema'
import type { ParseResult } from './types'
import { definitionErrors } from './validate'
import { exprErrors } from './validate-expr'
import { WHERE_SCHEMAS } from './where'

type Issue = z.core.$ZodIssue

const MISFIT_CODES = new Set(['unrecognized_keys', 'invalid_type', 'invalid_value'])

// A union branch doesn't fit the input when it fails at its own root (wrong type, value or keys).
function misfit(issue: Issue): boolean {
  if (issue.path.length > 0) {
    return false
  }
  if (issue.code === 'invalid_union') {
    return issue.errors.every((branch) => branch.some(misfit))
  }
  return MISFIT_CODES.has(issue.code)
}

// zod reports a failed union as "Invalid input". When one branch fits the input's keys, its own
// problem is the useful one (checks.0.worktree: expected one of …); else the union's own message.
function specific(issue: Issue): Issue {
  if (issue.code !== 'invalid_union') {
    return issue
  }
  const branch = issue.errors.find((b) => b.length > 0 && !b.some(misfit))
  if (!branch) {
    return issue
  }
  const inner = specific(branch[0])
  return { ...inner, path: [...issue.path, ...inner.path] } as Issue
}

function formatIssue(raw: Issue, prefix: PropertyKey[] = []): string {
  const issue = specific(raw)
  const path = [...prefix, ...issue.path].join('.')
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

// items.where is checked by its kind's schema, the same object the kind's item source reads.
function parseWhere(
  raw: RawAutomation
): { ok: true; where: Record<string, unknown> } | { ok: false; errors: string[] } {
  if (!raw.items) {
    return { ok: true, where: {} }
  }
  const parsed = WHERE_SCHEMAS[raw.items.kind].safeParse(raw.items.where ?? {})
  if (parsed.success) {
    return { ok: true, where: parsed.data as Record<string, unknown> }
  }
  return { ok: false, errors: parsed.error.issues.map((i) => formatIssue(i, ['items', 'where'])) }
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
  const where = parseWhere(parsed.data)
  if (!where.ok) {
    return { ok: false, errors: where.errors.map((e) => `${file}: ${e}`) }
  }
  const errors = [...definitionErrors(parsed.data), ...exprErrors(parsed.data)]
  if (errors.length > 0) {
    return { ok: false, errors: errors.map((e) => `${file}: ${e}`) }
  }
  return { ok: true, definition: normalize(parsed.data, file, where.where) }
}
