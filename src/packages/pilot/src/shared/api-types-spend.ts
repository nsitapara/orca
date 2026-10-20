import type { AgentKind } from './definition/types'

export type SpendGroup = 'automation' | 'skill' | 'agent' | 'mr'
export type SpendRow = {
  key: string
  label: string
  // null when none of the group's models has a price.
  costUsd: number | null
  tokens: number
  runs: number
  steps: number
  // Day-and-model buckets whose model has no price, so the cost leaves them out.
  unpricedBuckets: number
}
export type SpendPayload = {
  by: SpendGroup
  days: number
  sinceDay: string
  rows: SpendRow[]
  total: { costUsd: number; tokens: number; runs: number }
}
// What `pilot automations usage-report` wrote (Task 29c).
export type UsageReportResult = {
  dir: string
  rows: number
  sessions: number
  costUsd: number
  files: string[]
}

// The Usage page (pilot.usage.dashboard): what each automation spent over a period, split by whose tokens they were.
export type AgentUsage = { tokens: number; costUsd: number | null }
export type UsageByAgent = Record<AgentKind, AgentUsage>
export type UsageAutomationRow = {
  automationId: string
  name: string
  runs: number
  tokens: number
  costUsd: number | null
  byAgent: UsageByAgent
}
export type UsageDayRow = { day: string; byAgent: UsageByAgent }
export type UsageRunRow = {
  runId: string
  automationId: string
  name: string
  itemLabel: string
  startedAt: number
  status: string
  tokens: number
  costUsd: number | null
  byAgent: UsageByAgent
}
// One agent's spend from the day its weekly limit last reset, by automation, most expensive first.
export type UsageSinceReset = {
  sinceDay: string
  total: AgentUsage
  automations: { automationId: string; name: string; tokens: number; costUsd: number | null }[]
}
export type UsageDashboard = {
  days: number
  sinceDay: string
  total: { runs: number; tokens: number; costUsd: number | null; byAgent: UsageByAgent }
  // Most expensive first.
  automations: UsageAutomationRow[]
  // Every day of the period, oldest first; a day with nothing has zeros.
  daily: UsageDayRow[]
  topRuns: UsageRunRow[]
  sinceReset: Partial<Record<AgentKind, UsageSinceReset>>
  // Agent steps whose usage isn't in yet: still going, or ended and waiting to be read.
  pendingSteps: number
  measuredAt: number | null
}
