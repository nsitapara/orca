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
