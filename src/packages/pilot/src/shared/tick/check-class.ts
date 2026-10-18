import type { HoldReason } from '../api-types'
import type { CheckDef } from '../definition/types'

type RuntimeCheck = Extract<
  CheckDef,
  {
    kind:
      | 'quota'
      | 'worktree_idle'
      | 'worktree_clean'
      | 'session_none_open'
      | 'answers_none_pending'
      | 'window'
  }
>

// Runtime checks pass or fail with the moment, so a failure waits in line instead of skipping the item.
export function isRuntimeCheck(check: CheckDef): check is RuntimeCheck {
  switch (check.kind) {
    case 'quota':
    case 'worktree_idle':
    case 'worktree_clean':
    case 'session_none_open':
    case 'answers_none_pending':
    case 'window':
      return true
    case 'mr':
    case 'worktree_exists':
    case 'field':
    case 'script':
      return false
  }
}

export function holdCodeOf(check: CheckDef): HoldReason {
  switch (check.kind) {
    case 'quota':
      return 'quota'
    case 'worktree_idle':
      return 'worktree_busy'
    case 'worktree_clean':
      return 'in_flight'
    case 'session_none_open':
      return 'session_open'
    case 'answers_none_pending':
      return 'answers_pending'
    case 'window':
      return 'window'
    default:
      throw new Error(`${check.kind} is not a runtime check`)
  }
}
