import type Database from '../../../../../main/sqlite/sync-database'
import type { ItemFields, RunRow, StepKind } from '../../shared/api-types'
import { toRun } from './run-rows'

// A step row the run engine writes itself: a skipped step, or one whose starter threw before it
// could write its own.
export type AdvancedStep = {
  runId: string
  idx: number
  name: string
  agent: string
  skill: string | null
  mode: string | null
  whenExpr: string | null
  at: number
}
export type Spent = { costUsd: number | null; tokens: number | null }

const REOPEN_STEP = `UPDATE steps SET status = 'pending', started_at = ?, terminal_handle = NULL, pane_key = NULL,
  finished_at = NULL, error = NULL, outputs_json = '{}', exit_code = NULL, output_tail = NULL, launch_args_json = NULL,
  result_json = NULL WHERE run_id = ? AND idx = ?`
const FORGET_SESSION = `UPDATE steps SET session_id = NULL, transcript_path = NULL, session_pinned = 0
  WHERE run_id = ? AND idx = ?`

const INSERT_STEP = `INSERT INTO steps (run_id, idx, name, agent, skill, kind, mode, when_expr, status, started_at, finished_at, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

// A step's kind follows its agent: `shell` runs a command, any other agent is an agent step.
export function stepKindOf(agent: string): StepKind {
  if (agent === 'shell') {
    return 'shell'
  }
  return 'agent'
}

function stepValues(step: AdvancedStep, status: string, error: string): unknown[] {
  return [
    step.runId,
    step.idx,
    step.name,
    step.agent,
    step.skill,
    stepKindOf(step.agent),
    step.mode,
    step.whenExpr,
    status,
    step.at,
    step.at,
    error
  ]
}

// The run engine's queries: rows it writes, the cost rollup, runs left between steps and the item
// fields a run started from. (Open inbox items: `store.inbox.openCountForRun`; the run's once_per
// outcome: `store.setHandledStatus`.)
export class AdvanceStore {
  constructor(private readonly db: Database) {}

  recordSkippedStep(step: AdvancedStep, reason: string): void {
    this.db.prepare(INSERT_STEP).run(...(stepValues(step, 'skipped', reason) as never[]))
  }

  // The starter threw. Its row, if it wrote one and left it open, becomes failed; a row it never
  // wrote is added failed. A row it already closed keeps its own error.
  ensureFailedStep(step: AdvancedStep, error: string): void {
    this.endOpenStep(step, 'failed', error)
  }

  // The starter found nothing for the step to do (run/nothing-to-do.ts): as ensureFailedStep, but stopped.
  ensureStoppedStep(step: AdvancedStep, reason: string): void {
    this.endOpenStep(step, 'stopped', reason)
  }

  private endOpenStep(step: AdvancedStep, status: 'failed' | 'stopped', error: string): void {
    this.db
      .prepare(
        `${INSERT_STEP}
         ON CONFLICT (run_id, idx) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, error = excluded.error
         WHERE steps.status IN ('pending', 'starting', 'running')`
      )
      .run(...(stepValues(step, status, error) as never[]))
  }

  mergeStepOutputs(runId: string, idx: number, outputs: ItemFields): ItemFields {
    const row = this.db
      .prepare('SELECT outputs_json FROM steps WHERE run_id = ? AND idx = ?')
      .get(runId, idx) as { outputs_json: string } | undefined
    if (!row) {
      throw new Error(`Run ${runId} has no step ${idx}`)
    }
    const merged: ItemFields = { ...(JSON.parse(row.outputs_json) as ItemFields), ...outputs }
    this.db
      .prepare('UPDATE steps SET outputs_json = ? WHERE run_id = ? AND idx = ?')
      .run(JSON.stringify(merged), runId, idx)
    return merged
  }

  // A run's cost and tokens are the sums over its steps; null while no step has one.
  rollupCost(runId: string): Spent {
    const row = this.db
      .prepare(
        'SELECT SUM(cost_usd) AS cost, COUNT(cost_usd) AS priced, SUM(tokens) AS tokens, COUNT(tokens) AS counted FROM steps WHERE run_id = ?'
      )
      .get(runId) as
      | { cost: number | null; priced: number; tokens: number | null; counted: number }
      | undefined
    if (!row) {
      return { costUsd: null, tokens: null }
    }
    return {
      costUsd: Number(row.priced) > 0 ? Number(row.cost) : null,
      tokens: Number(row.counted) > 0 ? Number(row.tokens) : null
    }
  }

  // A run continued from step `idx` (run/run-continue.ts) is open again. Later steps go. That step's row stays, as
  // pending for its starter, so its cost and usage stay (a delete would cascade its step_usage away), and so does its
  // session when it is resumed.
  reopenFrom(runId: string, idx: number, keepSession: boolean, at: number): void {
    this.db.prepare('DELETE FROM steps WHERE run_id = ? AND idx > ?').run(runId, idx)
    this.db.prepare(REOPEN_STEP).run(at, runId, idx)
    if (!keepSession) {
      this.db.prepare(FORGET_SESSION).run(runId, idx)
    }
    this.db
      .prepare(
        "UPDATE runs SET status = 'running', outcome = NULL, finished_at = NULL WHERE id = ?"
      )
      .run(runId)
  }

  // Running runs with at least one step and none still open: between two steps, or never advanced.
  runsAwaitingAdvance(): RunRow[] {
    return this.db
      .prepare(
        `SELECT r.* FROM runs r
         WHERE r.status = 'running'
           AND EXISTS (SELECT 1 FROM steps s WHERE s.run_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM steps s WHERE s.run_id = r.id AND s.status IN ('pending', 'starting', 'running'))
         ORDER BY r.started_at, r.id`
      )
      .all()
      .map((r) => toRun(r as never))
  }

  tickItemFields(tickId: number, itemKey: string): ItemFields | null {
    const row = this.db
      .prepare('SELECT fields_json FROM tick_items WHERE tick_id = ? AND item_key = ?')
      .get(tickId, itemKey) as { fields_json: string } | undefined
    if (!row) {
      return null
    }
    return JSON.parse(row.fields_json) as ItemFields
  }
}
