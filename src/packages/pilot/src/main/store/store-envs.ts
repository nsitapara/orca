import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow } from '../../shared/api-types'
import type { EnvMode, RunEnvStack } from '../../shared/api-types-env'
import { worktreePathKey } from '../fields/agent-activity'
import { readEnvJson, type EnvJson } from './env-row'
import { toRun } from './run-rows'

export type { EnvJson }
export type EnvReady = {
  mode: EnvMode
  reason: string
  path: string
  home: string | null
  worktreeId: string
  sha: string | null
  envFile: string | null
  vars: Record<string, string>
  stack: RunEnvStack | null
}
const RETRY_CAP_MS = 60 * 60_000
// A delete that answered not_yet (its create still runs) is tried again this soon (Contract answers 5).
export const DELETE_WAIT_MS = 15_000
const ENDED = "status NOT IN ('running', 'asking')"

// The env columns of runs (V10). One row per run; pilotcli's own record is the truth about what exists.
export class EnvStore {
  constructor(private readonly db: Database) {}

  json(runId: string): EnvJson {
    const row = this.db.prepare('SELECT env_json FROM runs WHERE id = ?').get(runId) as
      | { env_json: unknown }
      | undefined
    return readEnvJson(row?.env_json)
  }

  begin(runId: string, home: string | null, json: EnvJson): void {
    this.db
      .prepare("UPDATE runs SET home_path = ?, env_state = 'preparing', env_json = ? WHERE id = ?")
      .run(home, JSON.stringify(json), runId)
  }

  // pilotcli made it and Pilot's runtime found the folder: the run works there from now on. False when the run ended
  // meanwhile (a cancel during create): nothing is recorded, and its teardown deletes what was made.
  ready(runId: string, r: EnvReady): boolean {
    const json = {
      ...this.json(runId),
      sha: r.sha,
      envFile: r.envFile,
      vars: r.vars,
      stack: r.stack
    }
    const changed = this.db
      .prepare(
        `UPDATE runs SET env_state = 'ready', env_mode = ?, env_reason = ?, env_path = ?, home_path = ?, worktree_path = ?,
           worktree_id = ?, env_json = ? WHERE id = ? AND status = 'running' AND env_state = 'preparing'`
      )
      .run(
        r.mode,
        r.reason,
        worktreePathKey(r.path),
        r.home,
        r.path,
        r.worktreeId,
        JSON.stringify(json),
        runId
      )
    return Number(changed.changes) > 0
  }

  // Create ended with no env to use (deferred, failed, refused or stopped). env delete still follows at the run's end,
  // whatever create made (Ruling P12): with nothing made it answers ok, removed: [].
  settle(runId: string, state: 'deferred' | 'failed', reason: string): void {
    this.db
      .prepare('UPDATE runs SET env_state = ?, env_reason = ? WHERE id = ?')
      .run(state, reason, runId)
  }

  // Records the delete in env_removed_at. A deferred env (not_yet, nothing ran) stays deferred: its outcome is kept.
  // kept: the branch env delete kept a throwaway's unhomed commits on, recorded with the env.
  removed(runId: string, at: number, kept?: string): void {
    const json = kept ? JSON.stringify({ ...this.json(runId), kept }) : null
    this.db
      .prepare(
        `UPDATE runs SET env_state = CASE WHEN env_state = 'deferred' THEN 'deferred' ELSE 'removed' END,
           env_removed_at = ?, env_delete_error = NULL, env_retry_at = NULL, env_json = COALESCE(?, env_json) WHERE id = ?`
      )
      .run(at, json, runId)
  }

  // hold_home: the step whose claim on home_path this run holds. The claim queries (store-runs.ts) count it only while
  // that step is starting or running, so a step that ends any way, a crash included, lets go.
  holdHome(runId: string, idx: number): void {
    this.db.prepare('UPDATE runs SET home_hold_step = ? WHERE id = ?').run(idx, runId)
  }

  releaseHome(runId: string, idx: number): void {
    this.db
      .prepare('UPDATE runs SET home_hold_step = NULL WHERE id = ? AND home_hold_step = ?')
      .run(runId, idx)
  }

  // The sweep found pilotcli still has it although Pilot recorded it removed: due for delete again at once, back in the
  // state it had (ready once made, else failed; deferred stays deferred), its backoff starting over.
  reopen(runId: string): void {
    this.db
      .prepare(
        `UPDATE runs SET env_state = CASE env_state WHEN 'removed'
             THEN CASE WHEN env_mode IS NULL THEN 'failed' ELSE 'ready' END ELSE env_state END,
           env_removed_at = NULL, env_retry_at = NULL, env_delete_error = NULL, env_delete_attempts = 0 WHERE id = ?`
      )
      .run(runId)
  }

  // env delete failed: the next try waits 1, 2, 4 … minutes, at most an hour. Returns the tries so far.
  deleteFailed(runId: string, error: string, at: number): number {
    const row = this.db
      .prepare('SELECT env_delete_attempts AS n FROM runs WHERE id = ?')
      .get(runId) as { n: number } | undefined
    const attempts = Number(row?.n ?? 0) + 1
    const wait = Math.min(RETRY_CAP_MS, 60_000 * 2 ** (attempts - 1))
    this.db
      .prepare(
        'UPDATE runs SET env_delete_error = ?, env_delete_attempts = ?, env_retry_at = ? WHERE id = ?'
      )
      .run(error, attempts, at + wait, runId)
    return attempts
  }

  // env delete answered not_yet ("create for <run> is still running"): try again soon. Not a failed try, never removed.
  deleteWaits(runId: string, reason: string, at: number): void {
    this.db
      .prepare('UPDATE runs SET env_delete_error = ?, env_retry_at = ? WHERE id = ?')
      .run(reason, at + DELETE_WAIT_MS, runId)
  }

  // env delete answered invalid (a name pilotcli refuses): retrying won't change it. Shown on the run, never due again.
  deleteRefused(runId: string, reason: string): void {
    this.db
      .prepare(
        "UPDATE runs SET env_state = 'stuck', env_delete_error = ?, env_retry_at = NULL WHERE id = ?"
      )
      .run(reason, runId)
  }

  // Ended runs whose env isn't removed and whose next try is due (never a stuck one). A run still 'preparing' is left to its preparation, or,
  // after a restart, to recovery (main/envs/recover.ts), which first stops a create a stopped Pilot left running.
  dueForTeardown(at: number): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE ${ENDED} AND env_state IN ('ready', 'deferred', 'failed')
           AND env_removed_at IS NULL AND (env_retry_at IS NULL OR env_retry_at <= ?) ORDER BY finished_at, id`
      )
      .all(at)
      .map((r) => toRun(r as never))
  }

  // At startup, the preparations a stopped Pilot may have left (main/envs/recover.ts): every env still preparing, ended or
  // not, and every run still running whose create was stopped with `stopped` (an app quit) although nothing closed the run.
  leftPreparing(stopped: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE env_state = 'preparing'
           OR (status = 'running' AND env_state = 'failed' AND env_reason = ?) ORDER BY started_at, id`
      )
      .all(stopped)
      .map((r) => toRun(r as never))
  }

  // Every run that ever had an env: the sweep maps pilotcli's rows onto them.
  withEnvs(): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE env_state IS NOT NULL')
      .all()
      .map((r) => toRun(r as never))
  }

  // A folder one of Pilot's throwaways works in now: never one of Nish's worktrees for a worktree automation.
  isThrowawayFolder(path: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM runs WHERE env_mode = 'throwaway' AND env_removed_at IS NULL AND env_path = ? LIMIT 1"
      )
      .get(worktreePathKey(path))
    return row !== undefined
  }
}
