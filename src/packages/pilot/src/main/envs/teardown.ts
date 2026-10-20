import type { RunRow } from '../../shared/api-types'
import type { RunEnv } from '../../shared/api-types-env'
import { envDeleteArgs } from '../../shared/run/env-args'
import { addRunEvent } from '../run/run-close'
import type { PilotStore } from '../store/store'
import type { Pilotcli } from './pilotcli'
import type { Preparations } from './prepare'

export const DELETE_TIMEOUT_MS = 10 * 60_000
const AT_ONCE = 2
// A run with these statuses is still going: its env is never torn down (nor swept, main/envs/sweep.ts).
export const LIVE: ReadonlySet<RunRow['status']> = new Set(['running', 'asking'])

export type TabDeps = {
  isOpen(handle: string): Promise<boolean>
  draft(handle: string): Promise<string>
  // Throws when the terminal's process couldn't be stopped.
  close(handle: string): Promise<void>
}
export type TeardownDeps = {
  store: PilotStore
  now(): number
  pilotcli: Pilotcli
  preparations: Pick<Preparations, 'stop'>
  // A create still running for this run that this process doesn't own (main/envs/orphan-create.ts).
  stopOrphanCreate(runId: string): Promise<void>
  tabs: TabDeps
  // The runtime forgets the removed folder (a rescan of the run's repo); best effort.
  forget(run: RunRow): void
  // env delete kept the throwaway's unhomed commits on a branch: bring them home (main/envs/kept-home.ts).
  kept?(runId: string): void
  log(message: string): void
}
export type Teardowns = { start(run: RunRow): void; housekeep(): void; settled(): Promise<void> }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// env delete's data.kept (pilotcli cf4d366): the branch it kept a throwaway's unhomed commits on. Older pilotcli: none.
function keptOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('kept' in data)) {
    return undefined
  }
  return typeof data.kept === 'string' && data.kept !== '' ? data.kept : undefined
}

// An ended run whose env may still need env delete. A preparing env counts: its create is stopped first.
function mayTearDown(run: RunRow | null): run is RunRow & { env: RunEnv } {
  return !!run?.env && run.env.removedAt === null && !LIVE.has(run.status)
}

export function createTeardowns(deps: TeardownDeps): Teardowns {
  const { store } = deps
  const inflight = new Map<string, Promise<void>>()

  // A throwaway's own step tabs close before its folder goes: only tabs the run opened itself, never one it borrowed (an
  // answer run's resumed asking tab belongs to the run that asked). A tab someone typed into, or one that can't be read or
  // stopped, keeps the folder until the next try; the reason says why.
  async function closeTabs(run: RunRow): Promise<string | null> {
    for (const handle of store.runs.ownTerminals(run.id)) {
      try {
        if (!(await deps.tabs.isOpen(handle))) {
          continue
        }
        if ((await deps.tabs.draft(handle)).trim() !== '') {
          return `someone is typing in terminal ${handle}`
        }
        await deps.tabs.close(handle)
      } catch (error) {
        return `terminal ${handle} couldn't be closed: ${messageOf(error)}`
      }
    }
    return null
  }

  function failedDelete(run: RunRow, reason: string): void {
    const attempts = store.runs.envs.deleteFailed(run.id, reason, deps.now())
    addRunEvent(store, deps.now(), run, 'env_delete_failed', { error: reason, attempts })
    deps.log(`[pilot] run ${run.id}: its env isn't removed yet (try ${attempts}): ${reason}`)
  }

  // M4 §8, the run ends however it ends: a create still in flight is stopped and has exited (it settles the env failed,
  // Ruling P2), then a throwaway's tabs close, then env delete, with --keep-folder for a kept worktree. A run still going
  // is left alone, its create included. The answers are Contract answers 5.
  async function teardown(runId: string): Promise<void> {
    if (!mayTearDown(store.runs.get(runId))) {
      return
    }
    await deps.preparations.stop(runId)
    const run = store.runs.get(runId)
    // Still preparing: a create a stopped Pilot left, which recovery stops first (main/envs/recover.ts).
    if (!mayTearDown(run) || run.env.state === 'preparing') {
      return
    }
    const { mode } = run.env
    if (mode === 'throwaway') {
      const busy = await closeTabs(run)
      if (busy) {
        failedDelete(run, busy)
        return
      }
    }
    const reply = await deps.pilotcli({
      args: envDeleteArgs(run.id, mode === 'kept'),
      timeoutMs: DELETE_TIMEOUT_MS
    })
    if (reply.outcome === 'ok') {
      const kept = keptOf(reply.data)
      store.runs.envs.removed(run.id, deps.now(), kept)
      deps.forget(run)
      if (kept) {
        deps.kept?.(run.id)
      }
      return
    }
    if (reply.outcome === 'not_yet') {
      await deps.stopOrphanCreate(run.id)
      store.runs.envs.deleteWaits(run.id, reply.reason || 'its create is still running', deps.now())
      return
    }
    if (reply.outcome === 'invalid') {
      const reason = reply.reason || 'pilotcli refused the run name'
      store.runs.envs.deleteRefused(run.id, reason)
      addRunEvent(store, deps.now(), run, 'env_delete_refused', { error: reason })
      deps.log(`[pilot] run ${run.id}: pilotcli refused to delete its env: ${reason}`)
      return
    }
    failedDelete(run, reply.reason || `env delete answered ${reply.outcome}`)
  }

  function start(run: RunRow): void {
    if (!run.env || inflight.has(run.id)) {
      return
    }
    const job = teardown(run.id)
      .catch((error: unknown) =>
        deps.log(`[pilot] run ${run.id}: removing its env failed: ${messageOf(error)}`)
      )
      .finally(() => inflight.delete(run.id))
    inflight.set(run.id, job)
  }

  return {
    start,
    // The scheduler's poll: every ended run whose env is due, at most two deletes at a time. Never awaits them.
    housekeep() {
      for (const run of store.runs.envs.dueForTeardown(deps.now())) {
        if (inflight.size >= AT_ONCE) {
          return
        }
        start(run)
      }
    },
    async settled() {
      while (inflight.size > 0) {
        await Promise.all(inflight.values())
      }
    }
  }
}
