import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow, StepKind, StepRow, StepStatus } from '../../shared/api-types'
import {
  encodeStep,
  RUN_COLUMNS,
  setClause,
  STEP_COLUMNS,
  toRun,
  toStep,
  type RunPatch,
  type StepPatch
} from './run-rows'
import { EnvStore } from './store-envs'

export type { RunPatch, StepPatch }
export type NewRun = Pick<
  RunRow,
  'id' | 'automationId' | 'tickId' | 'itemKey' | 'itemLabel' | 'worktreePath' | 'startedAt'
> &
  Partial<
    Pick<RunRow, 'status' | 'worktreeId' | 'trigger' | 'parentRunId' | 'imported' | 'queuedAt'>
  >
// M1 creates a step as it starts; a multi-step run may lay its steps out first as 'pending', unstarted.
export type NewStep = {
  runId: string
  idx: number
  name: string
  agent: string
  skill: string | null
  startedAt: number | null
  kind?: StepKind
  mode?: string | null
  whenExpr?: string | null
  // A session id known before launch (pinned Claude id, or the one resumed).
  sessionId?: string | null
  sessionPinned?: boolean
  status?: StepStatus
}

export class RunStore {
  // The env columns of these runs (V10).
  readonly envs: EnvStore

  constructor(private readonly db: Database) {
    this.envs = new EnvStore(db)
  }

  create(run: NewRun): void {
    this.db
      .prepare(
        'INSERT INTO runs (id, automation_id, tick_id, item_key, item_label, worktree_path, worktree_id, status, trigger, parent_run_id, imported, started_at, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        run.id,
        run.automationId,
        run.tickId,
        run.itemKey,
        run.itemLabel,
        run.worktreePath,
        run.worktreeId ?? null,
        run.status ?? 'running',
        run.trigger ?? 'schedule',
        run.parentRunId ?? null,
        run.imported ? 1 : 0,
        run.startedAt,
        run.queuedAt ?? null
      )
  }

  update(id: string, patch: RunPatch): void {
    const { sql, values } = setClause(patch, RUN_COLUMNS)
    if (sql) {
      this.db.prepare(`UPDATE runs SET ${sql} WHERE id = ?`).run(...(values as never[]), id)
    }
  }

  // Which of these runs are still live (asking or running), in one query.
  liveAmong(ids: string[]): Set<string> {
    if (ids.length === 0) {
      return new Set()
    }
    const rows = this.db
      .prepare(
        "SELECT id FROM runs WHERE status IN ('asking', 'running') AND id IN (SELECT value FROM json_each(?))"
      )
      .all(JSON.stringify(ids)) as { id: string }[]
    return new Set(rows.map((r) => r.id))
  }

  get(id: string): RunRow | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
    if (!r) {
      return null
    }
    return toRun(r as never)
  }

  forTick(tickId: number): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE tick_id = ? ORDER BY started_at, id')
      .all(tickId)
      .map((r) => toRun(r as never))
  }

  // Runs that finished at or after `at`, oldest finish first: the vault export's feed.
  finishedSince(at: number): RunRow[] {
    return this.db
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL AND finished_at >= ? ORDER BY finished_at, id'
      )
      .all(at)
      .map((r) => toRun(r as never))
  }

  createStep(step: NewStep): void {
    this.db
      .prepare(
        'INSERT INTO steps (run_id, idx, name, agent, skill, status, started_at, kind, mode, when_expr, session_id, session_pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        step.runId,
        step.idx,
        step.name,
        step.agent,
        step.skill,
        step.status ?? 'starting',
        step.startedAt,
        step.kind ?? 'agent',
        step.mode ?? null,
        step.whenExpr ?? null,
        step.sessionId ?? null,
        step.sessionPinned ? 1 : 0
      )
  }

  updateStep(runId: string, idx: number, patch: StepPatch): void {
    const { sql, values } = setClause(encodeStep(patch), STEP_COLUMNS)
    if (sql) {
      this.db
        .prepare(`UPDATE steps SET ${sql} WHERE run_id = ? AND idx = ?`)
        .run(...(values as never[]), runId, idx)
    }
  }

  // The launcher's 'starting' → 'running' write. False when the step was closed meanwhile (the sweep).
  updateStartingStep(runId: string, idx: number, patch: StepPatch): boolean {
    const { sql, values } = setClause(encodeStep(patch), STEP_COLUMNS)
    const r = this.db
      .prepare(`UPDATE steps SET ${sql} WHERE run_id = ? AND idx = ? AND status = 'starting'`)
      .run(...(values as never[]), runId, idx)
    return Number(r.changes) > 0
  }

  steps(runId: string): StepRow[] {
    return this.db
      .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY idx')
      .all(runId)
      .map((r) => toStep(r as never))
  }

  // A worktree's runs since `since`, plus any older one still running or asking; newest first. `paths` are
  // the spellings the worktree may be stored under (worktreePathSpellings).
  forWorktree(paths: readonly string[], since: number): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs
           WHERE (home_path IN (SELECT value FROM json_each(?))
             OR (home_path IS NULL AND worktree_path IN (SELECT value FROM json_each(?))))
           AND (started_at >= ? OR status IN ('running', 'asking')) ORDER BY started_at DESC, id`
      )
      .all(JSON.stringify(paths), JSON.stringify(paths), since)
      .map((r) => toRun(r as never))
  }

  // The steps starting or running on a terminal, newest first (more than one when a step was sent into
  // an earlier step's terminal while that one is still active): how `pilot run output|event` find their
  // step from the terminal they run in. A detached step (wait: start) counts: its session is still running.
  stepsOnTerminal(handle: string): StepRow[] {
    return this.db
      .prepare(
        "SELECT * FROM steps WHERE terminal_handle = ? AND (status IN ('starting', 'running') OR detached = 1) ORDER BY started_at DESC, idx DESC"
      )
      .all(handle)
      .map((r) => toStep(r as never))
  }

  // The terminals only this run's steps recorded: the tabs it opened for itself. A tab another run's step recorded too is
  // never this run's alone (an answer run that typed into the asking run's tab records that tab, borrowed).
  ownTerminals(runId: string): string[] {
    return this.db
      .prepare(
        `SELECT s.terminal_handle AS handle FROM steps s WHERE s.run_id = ? AND s.terminal_handle IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM steps o WHERE o.terminal_handle = s.terminal_handle AND o.run_id != s.run_id)
           GROUP BY s.terminal_handle ORDER BY MIN(s.idx)`
      )
      .all(runId)
      .map((r) => String((r as { handle: string }).handle))
  }

  // Every step, of any run and status, recorded on one of these terminals or panes: which open tabs are Pilot's, and whose.
  stepsOnTerminals(handles: readonly string[], paneKeys: readonly string[]): StepRow[] {
    if (handles.length === 0 && paneKeys.length === 0) {
      return []
    }
    return this.db
      .prepare(
        `SELECT * FROM steps WHERE terminal_handle IN (SELECT value FROM json_each(?))
           OR pane_key IN (SELECT value FROM json_each(?)) ORDER BY started_at, idx`
      )
      .all(JSON.stringify(handles), JSON.stringify(paneKeys))
      .map((r) => toStep(r as never))
  }

  runningSteps(): StepRow[] {
    return this.db
      .prepare("SELECT * FROM steps WHERE status IN ('starting', 'running')")
      .all()
      .map((r) => toStep(r as never))
  }

  // A step is 'starting' with no terminal only while its launch is in flight.
  staleStartingSteps(startedBefore: number): StepRow[] {
    return this.db
      .prepare(
        "SELECT * FROM steps WHERE status = 'starting' AND terminal_handle IS NULL AND started_at < ? ORDER BY started_at, run_id"
      )
      .all(startedBefore)
      .map((r) => toStep(r as never))
  }

  // Steps still 'pending' (their run's workspace is being made, B8) in running runs that started before
  // the cutoff. The sweep closes them unless this process is still opening the run.
  stalePendingSteps(runStartedBefore: number): StepRow[] {
    return this.db
      .prepare(
        `SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id
         WHERE s.status = 'pending' AND r.status = 'running' AND r.started_at < ?
         ORDER BY r.started_at, s.run_id, s.idx`
      )
      .all(runStartedBefore)
      .map((r) => toStep(r as never))
  }

  // A run is created a moment before its first step; one still without a step later never launched.
  staleRunsWithoutSteps(startedBefore: number): RunRow[] {
    return this.db
      .prepare(
        "SELECT r.* FROM runs r LEFT JOIN steps s ON s.run_id = r.id WHERE r.status = 'running' AND s.run_id IS NULL AND r.started_at < ? ORDER BY r.started_at, r.id"
      )
      .all(startedBefore)
      .map((r) => toRun(r as never))
  }

  // What the session check reads: this automation's steps in a worktree that are still starting or
  // running, plus finished ones (done/failed) with a terminal whose tab may still be open. Finished
  // steps count only back to `finishedSince`, so the check never walks the whole history.
  sessionStepsIn(automationId: string, worktreePath: string, finishedSince: number): StepRow[] {
    return this.db
      .prepare(
        `SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id
         WHERE r.automation_id = ? AND r.worktree_path = ?
           AND (s.status IN ('starting', 'running')
             OR (s.status IN ('done', 'failed') AND s.terminal_handle IS NOT NULL AND s.finished_at >= ?))
         ORDER BY s.started_at, s.run_id`
      )
      .all(automationId, worktreePath, finishedSince)
      .map((r) => toStep(r as never))
  }

  // Every automation's steps in a worktree, by the same rule as sessionStepsIn (session: none_open
  // with scope any, and session.open_any).
  sessionStepsAnyIn(worktreePath: string, finishedSince: number): StepRow[] {
    return this.db
      .prepare(
        `SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id
         WHERE r.worktree_path = ?
           AND (s.status IN ('starting', 'running')
             OR (s.status IN ('done', 'failed') AND s.terminal_handle IS NOT NULL AND s.finished_at >= ?))
         ORDER BY s.started_at, s.run_id`
      )
      .all(worktreePath, finishedSince)
      .map((r) => toStep(r as never))
  }

  // Where a session's transcript is: when its first step started (Codex files the rollout under that day)
  // and the newest transcript path a step recorded for it.
  sessionFacts(sessionId: string): {
    firstStartedAt: number | null
    transcriptPath: string | null
  } {
    const r = this.db
      .prepare(
        `SELECT MIN(started_at) AS first,
           (SELECT transcript_path FROM steps WHERE session_id = ? AND transcript_path IS NOT NULL
             ORDER BY started_at DESC LIMIT 1) AS path
         FROM steps WHERE session_id = ?`
      )
      .get(sessionId, sessionId) as { first: number | null; path: string | null } | undefined
    return {
      firstStartedAt: r?.first === null || r?.first === undefined ? null : Number(r.first),
      transcriptPath: r?.path ?? null
    }
  }

  // limits.at_once counts this automation's running runs only: a needs_you run holds no slot (H2).
  runningCount(automationId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM runs WHERE automation_id = ? AND status = 'running'")
      .get(automationId)
    return Number((row as { n: number } | undefined)?.n ?? 0)
  }

  // Item keys with a running run of this automation: a job runs once per item at a time.
  runningItemKeys(automationId: string): Set<string> {
    return new Set(
      this.db
        .prepare("SELECT item_key AS k FROM runs WHERE automation_id = ? AND status = 'running'")
        .all(automationId)
        .map((r) => String(r.k))
    )
  }

  // Worktrees with a running run of any automation: one agent per worktree across automations (§6). A run's home
  // counts too while one of its hold_home steps runs.
  runningWorktreePaths(): Set<string> {
    return new Set(
      this.db
        .prepare(
          `SELECT worktree_path AS path FROM runs WHERE status = 'running' AND worktree_path IS NOT NULL
           UNION SELECT r.home_path FROM runs r JOIN steps s ON s.run_id = r.id AND s.idx = r.home_hold_step
             WHERE r.status = 'running' AND r.home_path IS NOT NULL AND s.status IN ('starting', 'running')`
        )
        .all()
        .map((r) => String((r as { path: string }).path))
    )
  }

  // One agent per worktree across automations (contract §6): every running run there, of any automation, a hold_home
  // step's run included.
  runningInWorktree(worktreePath: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs r WHERE r.status = 'running' AND (r.worktree_path = ?
           OR (r.home_path = ? AND EXISTS (SELECT 1 FROM steps s WHERE s.run_id = r.id AND s.idx = r.home_hold_step
             AND s.status IN ('starting', 'running'))))
         ORDER BY r.started_at, r.id`
      )
      .all(worktreePath, worktreePath)
      .map((r) => toRun(r as never))
  }
}
