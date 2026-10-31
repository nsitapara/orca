import type { AgentKind } from './definition/types'

export type QuotaCeiling = { weekly: number; session: number }

// The ceilings automations stop at, per agent; both the quota check and the answer holds read it.
export const QUOTA_CEILING: Record<AgentKind, QuotaCeiling> = {
  claude: { weekly: 90, session: 95 },
  codex: { weekly: 98, session: 98 }
}
