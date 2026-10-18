export type ActionPhase = 'check' | 'ready' | 'do'
// act.py's outcome words are first-class statuses (R-4); 'refused' is an attempt the engine turned away.
export type ActionRunStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'stale'
  | 'needs_agent'
  | 'not_yet'
  | 'refused'
export type ActionRunRow = {
  id: number
  inboxItemId: string | null
  runId: string | null
  action: string
  args: Record<string, unknown>
  digest: string
  phase: ActionPhase
  status: ActionRunStatus
  output: string | null
  dryRun: boolean
  startedAt: number
  finishedAt: number | null
}
