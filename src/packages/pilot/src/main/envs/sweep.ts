import type { RunRow } from '../../shared/api-types'
import { ENV_LIST_ARGS, envDeleteArgs } from '../../shared/run/env-args'
import { worktreePathKey } from '../fields/agent-activity'
import { addRunEvent } from '../run/run-close'
import type { PilotStore } from '../store/store'
import { parseEnvRows, type EnvListRow } from './env-result'
import type { Pilotcli } from './pilotcli'
import { DELETE_TIMEOUT_MS, keptOf, LIVE } from './teardown'

export const LIST_TIMEOUT_MS = 60_000
// How long an owned env outlives its run's end: a subagent may still be finishing in it.
export const OWNED_GRACE_MS = 10 * 60_000
export type SweepReport = { deleted: string[]; removed: string[]; skipped: number }
export type SweepDeps = {
  store: PilotStore
  pilotcli: Pilotcli
  teardown(run: RunRow): void
  // A create this process is running for the run (Preparations.isPreparing).
  isPreparing(runId: string): boolean
  now(): number
  log(message: string): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameFolder(row: EnvListRow, run: RunRow): boolean {
  const recorded = run.env?.path ?? null
  return recorded === null || row.path === null || worktreePathKey(row.path) === recorded
}

// May the sweep delete this row's env (M4 §4, Contract answers 4)? Only for one of this Pilot's own runs, matched by `run`
// exactly as create was given it, that has ended, isn't still being made here, isn't stuck, and lives where Pilot recorded.
function deletable(row: EnvListRow, run: RunRow, deps: SweepDeps): boolean {
  if (LIVE.has(run.status) || run.env?.state === 'stuck' || !sameFolder(row, run)) {
    return false
  }
  return !(row.status === 'creating' && deps.isPreparing(run.id))
}

// An ended run's env pilotcli no longer lists is gone already. One still preparing is its preparation's (or recovery's).
function goneUnlisted(run: RunRow, listed: ReadonlySet<string>): boolean {
  const env = run.env
  if (!env || env.removedAt !== null || env.state === 'preparing') {
    return false
  }
  return !LIVE.has(run.status) && !listed.has(run.id)
}

// env list's rows, or null (logged) when it failed or answered anything but a list: then nothing is touched.
async function listEnvs(deps: Pick<SweepDeps, 'pilotcli' | 'log'>): Promise<EnvListRow[] | null> {
  try {
    const reply = await deps.pilotcli({ args: ENV_LIST_ARGS, timeoutMs: LIST_TIMEOUT_MS })
    if (reply.outcome !== 'ok') {
      throw new Error(reply.reason || `env list answered ${reply.outcome}`)
    }
    return parseEnvRows(reply.data)
  } catch (error) {
    deps.log(`[pilot] env sweep skipped: ${messageOf(error)}`)
    return null
  }
}

// An env this sweep may record removed: its own teardown may have recorded it removed while env list ran; keep that.
function stillUnremoved(store: PilotStore, runId: string): boolean {
  const env = store.runs.get(runId)?.env
  return env !== null && env !== undefined && env.removedAt === null
}

// At startup, after recovery (M4 §8, Pilot starts): env delete for every env pilotcli lists whose run is one of this
// Pilot's that has ended. Orphans (run "") and runs Pilot doesn't know are Nish's to delete. An ended run's env that
// pilotcli no longer lists is recorded removed. Runs are read before the list, so a run that ends while it runs is left
// to its own teardown.
export async function sweepEnvs(deps: SweepDeps): Promise<SweepReport> {
  const report: SweepReport = { deleted: [], removed: [], skipped: 0 }
  // Read before env list: a run that ends while the list runs is still live here, so its own teardown deletes its env.
  const runs = deps.store.runs.envs.withEnvs()
  const rows = await listEnvs(deps)
  if (rows === null) {
    return report
  }
  const byId = new Map(runs.map((run) => [run.id, run]))
  const listed = new Set<string>()
  for (const row of rows) {
    const run = row.run === '' || row.orphan ? undefined : byId.get(row.run)
    if (!run) {
      report.skipped += 1
      continue
    }
    listed.add(run.id)
    if (!deletable(row, run, deps)) {
      report.skipped += 1
      continue
    }
    if (run.env && run.env.removedAt !== null) {
      deps.store.runs.envs.reopen(run.id)
    }
    deps.teardown(deps.store.runs.get(run.id) ?? run)
    report.deleted.push(run.id)
  }
  for (const run of runs.filter((r) => goneUnlisted(r, listed))) {
    if (!stillUnremoved(deps.store, run.id)) {
      continue
    }
    deps.store.runs.envs.removed(run.id, deps.now())
    report.removed.push(run.id)
  }
  return report
}

export type OwnedSweepDeps = Pick<SweepDeps, 'store' | 'pilotcli' | 'now' | 'log'> & {
  // One of the owner's own tabs is still open: its agent may still work in the env.
  agentOpen(owner: RunRow): Promise<boolean>
  // The last failure recorded per env, so a delete that keeps failing adds one run event per new reason.
  noted: Map<string, string>
}

// The ended run that owns this row's env, once OWNED_GRACE_MS has passed, else null. An agent in that run's step made it
// under another name (owner_run, the step's PILOT_RUN_ID: job 14's <run>-draft), so no run row records it and the run's
// teardown never sees it. Only a throwaway, and only one made before the run ended: an answer run resuming the tab keeps
// the old PILOT_RUN_ID.
function endedOwner(row: EnvListRow, deps: OwnedSweepDeps): RunRow | null {
  const ownsOther = row.ownerRun !== '' && row.ownerRun !== row.run
  if (row.orphan || row.mode !== 'throwaway' || !ownsOther || deps.store.runs.get(row.run)) {
    return null
  }
  const owner = deps.store.runs.get(row.ownerRun)
  const end = owner?.finishedAt ?? null
  if (!owner || LIVE.has(owner.status) || end === null || row.created === null) {
    return null
  }
  return row.created <= end && deps.now() - end >= OWNED_GRACE_MS ? owner : null
}

// The scheduler's poll, every few minutes: env delete for each env an ended run owns (endedOwner) once its agent's tabs
// have closed. Each delete is an event on the owner's run; one that fails is tried again on the next sweep.
export async function sweepOwnedEnvs(deps: OwnedSweepDeps): Promise<string[]> {
  const deleted: string[] = []
  for (const row of (await listEnvs(deps)) ?? []) {
    const owner = endedOwner(row, deps)
    if (!owner || (await deps.agentOpen(owner))) {
      continue
    }
    const reply = await deps.pilotcli({
      args: envDeleteArgs(row.run, false),
      timeoutMs: DELETE_TIMEOUT_MS
    })
    if (reply.outcome === 'ok') {
      deps.noted.delete(row.run)
      addRunEvent(deps.store, deps.now(), owner, 'owned_env_removed', {
        env: row.run,
        kept: keptOf(reply.data) ?? null
      })
      deleted.push(row.run)
      continue
    }
    const reason = reply.reason || `env delete answered ${reply.outcome}`
    deps.log(`[pilot] run ${owner.id}: couldn't delete its env ${row.run}: ${reason}`)
    if (deps.noted.get(row.run) !== reason) {
      deps.noted.set(row.run, reason)
      addRunEvent(deps.store, deps.now(), owner, 'owned_env_delete_failed', {
        env: row.run,
        error: reason
      })
    }
  }
  return deleted
}
