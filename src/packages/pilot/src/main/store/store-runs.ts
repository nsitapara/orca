import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow, RunStatus, StepRow, StepStatus } from '../../shared/api-types'

export type NewRun = Pick<
  RunRow,
  'id' | 'automationId' | 'tickId' | 'itemKey' | 'itemLabel' | 'worktreePath' | 'startedAt'
>
export type NewStep = {
  runId: string
  idx: number
  name: string
  agent: string
  skill: string | null
  startedAt: number
}
type RunPatch = Partial<{
  status: RunStatus
  outcome: string | null
  finishedAt: number
  costUsd: number | null
  tokens: number | null
}>
type StepPatch = Partial<{
  status: StepStatus
  terminalHandle: string
  paneKey: string
  sessionId: string
  transcriptPath: string
  costUsd: number | null
  tokens: number | null
  finishedAt: number
  error: string
}>

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  status: 'status',
  outcome: 'outcome',
  finishedAt: 'finished_at',
  costUsd: 'cost_usd',
  tokens: 'tokens'
}
const STEP_COLUMNS: Record<keyof StepPatch, string> = {
  status: 'status',
  terminalHandle: 'terminal_handle',
  paneKey: 'pane_key',
  sessionId: 'session_id',
  transcriptPath: 'transcript_path',
  costUsd: 'cost_usd',
  tokens: 'tokens',
  finishedAt: 'finished_at',
  error: 'error'
}

function setClause<T extends object>(
  patch: T,
  columns: Record<keyof T, string>
): { sql: string; values: unknown[] } {
  const keys = Object.keys(patch) as (keyof T)[]
  return {
    sql: keys.map((k) => `${columns[k]} = ?`).join(', '),
    values: keys.map((k) => patch[k] ?? null)
  }
}

function toRun(r: Record<string, unknown>): RunRow {
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
    tokens: (r.tokens as number | null) ?? null
  }
}

function toStep(r: Record<string, unknown>): StepRow {
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
    error: (r.error as string | null) ?? null
  }
}

export class RunStore {
  constructor(private readonly db: Database) {}

  create(run: NewRun): void {
    this.db
      .prepare(
        'INSERT INTO runs (id, automation_id, tick_id, item_key, item_label, worktree_path, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        run.id,
        run.automationId,
        run.tickId,
        run.itemKey,
        run.itemLabel,
        run.worktreePath,
        'running',
        run.startedAt
      )
  }

  update(id: string, patch: RunPatch): void {
    const { sql, values } = setClause(patch, RUN_COLUMNS)
    if (sql) {
      this.db.prepare(`UPDATE runs SET ${sql} WHERE id = ?`).run(...(values as never[]), id)
    }
  }

  forTick(tickId: number): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE tick_id = ? ORDER BY started_at, id')
      .all(tickId)
      .map((r) => toRun(r as never))
  }

  createStep(step: NewStep): void {
    this.db
      .prepare(
        'INSERT INTO steps (run_id, idx, name, agent, skill, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(step.runId, step.idx, step.name, step.agent, step.skill, 'starting', step.startedAt)
  }

  updateStep(runId: string, idx: number, patch: StepPatch): void {
    const { sql, values } = setClause(patch, STEP_COLUMNS)
    if (sql) {
      this.db
        .prepare(`UPDATE steps SET ${sql} WHERE run_id = ? AND idx = ?`)
        .run(...(values as never[]), runId, idx)
    }
  }

  steps(runId: string): StepRow[] {
    return this.db
      .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY idx')
      .all(runId)
      .map((r) => toStep(r as never))
  }

  runningSteps(): StepRow[] {
    return this.db
      .prepare("SELECT * FROM steps WHERE status IN ('starting', 'running')")
      .all()
      .map((r) => toStep(r as never))
  }

  openStepsIn(automationId: string, worktreePath: string): StepRow[] {
    return this.db
      .prepare(
        "SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.automation_id = ? AND r.worktree_path = ? AND s.status IN ('starting', 'running')"
      )
      .all(automationId, worktreePath)
      .map((r) => toStep(r as never))
  }

  runningCount(automationId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM runs WHERE automation_id = ? AND status = 'running'")
      .get(automationId)
    return Number((row as { n: number } | undefined)?.n ?? 0)
  }
}
