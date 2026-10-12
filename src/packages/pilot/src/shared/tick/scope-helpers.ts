import type { FieldValue, ScopeResult } from '../api-types'

export const IN_SCOPE: ScopeResult = { ok: true }

export function outOfScope(reason: string): ScopeResult {
  return { ok: false, verdict: 'out_of_scope', reason }
}

export function notDue(reason: string): ScopeResult {
  return { ok: false, verdict: 'notdue', reason }
}

// The first clause that fails, in order; in scope when none does.
export function firstFailure(clauses: readonly (() => ScopeResult)[]): ScopeResult {
  for (const clause of clauses) {
    const result = clause()
    if (!result.ok) {
      return result
    }
  }
  return IN_SCOPE
}

export function textOf(value: FieldValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function numberOf(value: FieldValue | undefined): number | null {
  return typeof value === 'number' ? value : null
}

// A comma-list field: '' is an empty list.
export function listOf(value: FieldValue | undefined): string[] {
  return typeof value === 'string' && value !== '' ? value.split(',') : []
}
