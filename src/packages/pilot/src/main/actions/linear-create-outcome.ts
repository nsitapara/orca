import type { LinearErrorCode } from '../../../../../shared/linear/agent-access'
import { actionFailed, type ActionResult } from './types'

// linearIssueCreate's codes for a certain no (a check before the write, or Linear refusing it); others are maybe.
const NOT_CREATED: ReadonlySet<string> = new Set<LinearErrorCode>([
  'linear_not_connected',
  'linear_workspace_ambiguous',
  'linear_invalid_workspace',
  'linear_team_required',
  'linear_invalid_state',
  'linear_invalid_assignee',
  'linear_invalid_label',
  'linear_body_too_large',
  'linear_write_failed',
  'linear_auth_expired',
  'linear_rate_limited',
  'linear_permission_denied'
])

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : null
  }
  return null
}

// A linear_create that stopped before anything reached Linear's create.
export function notCreated(outcome: 'failed' | 'stale', detail: string): ActionResult {
  return { outcome, detail, link: null, log: null, onYou: false, data: { created: 'no' } }
}

// A failed create call, saying whether Linear may still have made the ticket.
export function createFailed(error: unknown, detail: string): ActionResult {
  const code = codeOf(error)
  const created = code !== null && NOT_CREATED.has(code) ? 'no' : 'maybe'
  return { ...actionFailed(detail), data: { created } }
}
