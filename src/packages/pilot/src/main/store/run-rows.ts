import type {
  ItemFields,
  RunRow,
  RunStatus,
  RunTrigger,
  StepKind,
  StepRow,
  StepStatus,
  StoredResult
} from '../../shared/api-types'
import { envOfRow } from './env-row'

export type RunPatch = Partial<{
  status: RunStatus
  outcome: string | null
  finishedAt: number
  costUsd: number | null
  tokens: number | null
  worktreePath: string | null
  worktreeId: string | null
  acknowledgedAt: number | null
}>
export type StepPatch = Partial<{
  status: StepStatus
  // An env answer run's step 0 learns its agent, skill and mode once its folder decides the route (answers/answer-env.ts).
  agent: string
  skill: string | null
  mode: string | null
  terminalHandle: string
  paneKey: string
  sessionId: string
  transcriptPath: string
  costUsd: number | null
  tokens: number | null
  startedAt: number
  finishedAt: number
  error: string
  model: string | null
  outputs: ItemFields
  exitCode: number | null
  outputTail: string | null
  sessionPinned: boolean
  launchArgs: string[] | null
  result: StoredResult | null
}>

export const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  status: 'status',
  outcome: 'outcome',
  finishedAt: 'finished_at',
  costUsd: 'cost_usd',
  tokens: 'tokens',
  worktreePath: 'worktree_path',
  worktreeId: 'worktree_id',
  acknowledgedAt: 'acknowledged_at'
}
export const STEP_COLUMNS: Record<keyof StepPatch, string> = {
  status: 'status',
  agent: 'agent',
  skill: 'skill',
  mode: 'mode',
  terminalHandle: 'terminal_handle',
  paneKey: 'pane_key',
  sessionId: 'session_id',
  transcriptPath: 'transcript_path',
  costUsd: 'cost_usd',
  tokens: 'tokens',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  error: 'error',
  model: 'model',
  outputs: 'outputs_json',
  exitCode: 'exit_code',
  outputTail: 'output_tail',
  sessionPinned: 'session_pinned',
  launchArgs: 'launch_args_json',
  result: 'result_json'
}

// Values go in as they are, except outputs (JSON text) and the pinned flag (0/1), whose columns are
// NOT NULL, and the launch args and the result (JSON text, or NULL).
export function encodeStep(patch: StepPatch): Record<string, unknown> {
  const encoded: Record<string, unknown> = { ...patch }
  if ('outputs' in patch) {
    encoded.outputs = JSON.stringify(patch.outputs ?? {})
  }
  if ('launchArgs' in patch) {
    encoded.launchArgs = patch.launchArgs ? JSON.stringify(patch.launchArgs) : null
  }
  if ('result' in patch) {
    encoded.result = patch.result ? JSON.stringify(patch.result) : null
  }
  if ('sessionPinned' in patch) {
    encoded.sessionPinned = patch.sessionPinned ? 1 : 0
  }
  return encoded
}

export function setClause(
  patch: Record<string, unknown>,
  columns: Record<string, string>
): { sql: string; values: unknown[] } {
  const keys = Object.keys(patch)
  return {
    sql: keys.map((k) => `${columns[k]} = ?`).join(', '),
    values: keys.map((k) => patch[k] ?? null)
  }
}

export function toRun(r: Record<string, unknown>): RunRow {
  return {
    id: String(r.id),
    automationId: String(r.automation_id),
    tickId: (r.tick_id as number | null) ?? null,
    itemKey: String(r.item_key),
    itemLabel: String(r.item_label),
    worktreePath: (r.worktree_path as string | null) ?? null,
    status: r.status as RunStatus,
    outcome: (r.outcome as string | null) ?? null,
    startedAt: Number(r.started_at),
    finishedAt: (r.finished_at as number | null) ?? null,
    costUsd: (r.cost_usd as number | null) ?? null,
    tokens: (r.tokens as number | null) ?? null,
    worktreeId: (r.worktree_id as string | null) ?? null,
    trigger: r.trigger as RunTrigger,
    parentRunId: (r.parent_run_id as string | null) ?? null,
    imported: Number(r.imported) === 1,
    homePath: (r.home_path as string | null) ?? null,
    env: envOfRow(r),
    acknowledgedAt: (r.acknowledged_at as number | null) ?? null,
    queuedAt: (r.queued_at as number | null) ?? null
  }
}

export function toStep(r: Record<string, unknown>): StepRow {
  return {
    runId: String(r.run_id),
    idx: Number(r.idx),
    name: String(r.name),
    agent: String(r.agent),
    skill: (r.skill as string | null) ?? null,
    status: r.status as StepStatus,
    terminalHandle: (r.terminal_handle as string | null) ?? null,
    paneKey: (r.pane_key as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    transcriptPath: (r.transcript_path as string | null) ?? null,
    costUsd: (r.cost_usd as number | null) ?? null,
    tokens: (r.tokens as number | null) ?? null,
    startedAt: (r.started_at as number | null) ?? null,
    finishedAt: (r.finished_at as number | null) ?? null,
    error: (r.error as string | null) ?? null,
    kind: r.kind as StepKind,
    mode: (r.mode as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    outputs: JSON.parse(String(r.outputs_json)) as ItemFields,
    whenExpr: (r.when_expr as string | null) ?? null,
    exitCode: (r.exit_code as number | null) ?? null,
    outputTail: (r.output_tail as string | null) ?? null,
    sessionPinned: Number(r.session_pinned) === 1,
    launchArgs: r.launch_args_json ? (JSON.parse(String(r.launch_args_json)) as string[]) : null,
    result: r.result_json ? (JSON.parse(String(r.result_json)) as StoredResult) : null
  }
}
