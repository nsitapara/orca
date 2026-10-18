import { describe, expect, it } from 'vitest'
import type { HoldReason } from '../api-types'
import type { CheckDef } from '../definition/types'
import { holdCodeOf, isRuntimeCheck, type RuntimeCheck } from './check-class'

const RUNTIME: [RuntimeCheck, HoldReason][] = [
  [{ kind: 'quota', agent: 'claude', weekly: 90, session: 95 }, 'quota'],
  [{ kind: 'worktree_idle' }, 'worktree_busy'],
  [{ kind: 'worktree_clean' }, 'in_flight'],
  [{ kind: 'session_none_open', scope: 'any' }, 'session_open'],
  [{ kind: 'answers_none_pending' }, 'answers_pending'],
  [{ kind: 'window', start: '09:00', end: '17:00' }, 'window']
]
const STATIC: CheckDef[] = [
  { kind: 'mr', rule: 'mine' },
  { kind: 'worktree_exists' },
  { kind: 'field', expr: 'x', reason: 'y' },
  { kind: 'script', run: 'true', timeoutMs: 1000 }
]

describe('check class', () => {
  it.each(RUNTIME)('%j is a runtime check holding as %s', (check, code) => {
    expect(isRuntimeCheck(check)).toBe(true)
    expect(holdCodeOf(check)).toBe(code)
  })

  it.each(STATIC)('%j is not a runtime check', (check) => {
    expect(isRuntimeCheck(check)).toBe(false)
  })
})
