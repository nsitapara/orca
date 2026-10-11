export type PilotStatus = {
  version: string
  process: 'main' | 'orcad'
  dataPath: string
  automationDirs: string[]
  missingDirs: string[]
  // A people.yaml problem or notice (e.g. people.yaml and people.yml both exist). Never blocks loading.
  peopleError: string | null
  // Why Pilot couldn't start (store won't open, …); null while it runs. Orca itself keeps running.
  error: string | null
}

export type FieldValue = string | number | boolean | null
export type ItemFields = Record<string, FieldValue>

export type Verdict = 'started' | 'skipped' | 'notdue' | 'out_of_scope' | 'over_limit' | 'baselined'
export type CheckOutcome = { check: string; ok: boolean; reason: string }
export type TickItem = { key: string; label: string; fields: ItemFields }
export type ItemDecision = {
  key: string
  label: string
  verdict: Verdict
  reason: string
  checks: CheckOutcome[]
  onceKey: string
  fields: ItemFields
}

export type TickRow = {
  id: number
  automationId: string
  startedAt: number
  finishedAt: number | null
  dryRun: boolean
  status: 'running' | 'ok' | 'failed'
  error: string | null
  counts: Partial<Record<Verdict, number>>
}
export type TickItemRow = {
  tickId: number
  itemKey: string
  label: string
  verdict: Verdict
  reason: string
  checks: CheckOutcome[]
  fields: ItemFields
  runId: string | null
}
export type RunStatus = 'running' | 'done' | 'failed'
export type RunRow = {
  id: string
  automationId: string
  tickId: number | null
  itemKey: string
  itemLabel: string
  worktreePath: string | null
  status: RunStatus
  outcome: string | null
  startedAt: number
  finishedAt: number | null
  costUsd: number | null
  tokens: number | null
}
export type StepStatus = 'starting' | 'running' | 'done' | 'failed'
export type StepRow = {
  runId: string
  idx: number
  name: string
  agent: string
  skill: string | null
  status: StepStatus
  terminalHandle: string | null
  paneKey: string | null
  sessionId: string | null
  transcriptPath: string | null
  costUsd: number | null
  tokens: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export type TickResult = {
  tickId: number
  status: 'ok' | 'failed'
  error: string | null
  decisions: ItemDecision[]
}
