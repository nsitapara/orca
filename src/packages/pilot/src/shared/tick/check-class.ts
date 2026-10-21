import type { HoldReason } from '../api-types'
import type { CheckDef } from '../definition/types'

export type RuntimeCheck = Extract<
  CheckDef,
  {
    kind: 'quota' | 'session_none_open' | 'answers_none_pending' | 'window' | 'kept_ready'
  }
>

// Runtime checks pass or fail with the moment, so a failure waits in line instead of skipping the item.
export function isRuntimeCheck(check: CheckDef): check is RuntimeCheck {
  switch (check.kind) {
    case 'quota':
    case 'session_none_open':
    case 'answers_none_pending':
    case 'window':
    case 'kept_ready':
      return true
    case 'mr':
    case 'worktree_exists':
    case 'field':
    case 'script':
      return false
  }
}

export function holdCodeOf(check: RuntimeCheck): HoldReason {
  switch (check.kind) {
    case 'quota':
      return 'quota'
    case 'session_none_open':
      return 'session_open'
    case 'answers_none_pending':
      return 'answers_pending'
    case 'window':
      return 'window'
    case 'kept_ready':
      return 'merge_blocked'
  }
}
