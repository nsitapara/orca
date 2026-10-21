import { rmSync } from 'node:fs'
import type { ItemFields, RunRow } from '../../shared/api-types'
import type { EnvWorkspaceDef } from '../../shared/definition/types'
import {
  envCreateArgs,
  holdsWorktree,
  resolveEnv,
  type ResolvedEnvWorkspace
} from '../../shared/run/env-args'
import type { RunEnd } from '../../shared/run/step-plan'
import type { CloseOptions } from '../run/run-close'
import type { RunStore } from '../store/store-runs'
import { parseEnvResult, type EnvResult } from './env-result'
import { claimHome, heldFolderReason, holderOf, throwawayReason } from './hold'
import type { Pilotcli, PilotcliReply } from './pilotcli'

// Setup plus a stack's 20-minute readiness (M4 §2.4), with room for the cap's wait.
export const CREATE_TIMEOUT_MS = 45 * 60_000
export const STOPPED = 'stopped while it was being made'

export type PrepareRequest = {
  run: RunRow
  env: EnvWorkspaceDef
  repo: string
  label: string
  // The item's fields and run.*: what the subject's templates read.
  fields: ItemFields
}
// What follows: start the steps (the run engine) or launch the answers (an answer run), or end the run.
export type PreparedHooks = {
  ready(): Promise<void>
  end(end: RunEnd, opts: CloseOptions): void
}
export type EnvPreparer = {
  // Synchronous: holds the worktree, records the run as preparing and starts env create, then returns. Throws, with
  // nothing started, when the subject can't be rendered or the stack resolves to no stack.
  begin(req: PrepareRequest, hooks: PreparedHooks): void
  isPreparing(runId: string): boolean
}
export type Preparations = EnvPreparer & {
  // Stops a create in flight for this run, then waits until it settled (teardown, before env delete).
  stop(runId: string): Promise<void>
  // App quit: each create in flight gets SIGTERM on its group at once. Nothing is awaited; its delete runs at the next start.
  stopAll(): void
  settled(): Promise<void>
}
export type PrepareDeps = {
  runs: RunStore
  pilotcli: Pilotcli
  resolvePath(
    repo: string,
    path: string,
    signal: AbortSignal
  ): Promise<{ id: string; path: string }>
  nameOf(automationId: string): string
  pidFile(runId: string): string
  preparer(): { pid: number; identity: string | null }
  // Sets the throwaway's sidebar name and nests it under its home (its detached HEAD would show the repo's name).
  nestThrowaway(worktreeId: string, home: string, label: string): Promise<void>
  log(message: string): void
}
type Flight = { controller: AbortController; done: Promise<void> }
type Planned = { runId: string; job: string; home: string | null; heldBy: string | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A throwaway's sidebar name: its job, and the commit it was checked out at.
function throwawayLabel(job: string, sha: string | null): string {
  return sha ? `${job} · @${sha.slice(0, 7)}` : job
}

// A throwaway run's home, the item's worktree: the subject's for --worktree, else the item's own, else the repo's main
// checkout. In place or kept, the home is the folder pilotcli named (afterCreate).
function throwawayHome(env: ResolvedEnvWorkspace, fields: ItemFields): string | null {
  if (env.subject.kind === 'worktree') {
    return env.subject.worktree
  }
  for (const key of ['worktree.path', 'repo.path']) {
    const value = fields[key]
    if (typeof value === 'string' && value !== '') {
      return value
    }
  }
  return null
}

// The one rule pilotcli's answer must fit (Contract answers 3): Pilot asked for a throwaway, so never in place. Any mode can
// come back for any subject, so nothing else is assumed from the subject.
function checkWhere(result: EnvResult, plan: Planned): void {
  if (result.mode === 'in_place' && plan.heldBy !== null) {
    throw new Error(
      `pilotcli worked in place although Pilot said another run holds ${plan.home ?? 'it'}`
    )
  }
}

export function createPreparations(deps: PrepareDeps): Preparations {
  const flights = new Map<string, Flight>()

  // failed or invalid (§8): the run fails with the reason. The env stays due for env delete at the run's end whatever
  // create made (Ruling P12): with nothing made, delete answers ok, removed: [].
  function failed(plan: Planned, hooks: PreparedHooks, reason: string): void {
    deps.runs.envs.settle(plan.runId, 'failed', reason)
    hooks.end({ status: 'failed', outcome: `Couldn't prepare its workspace: ${reason}` }, {})
  }

  // Nothing ran: the once_per key is freed and handed-over ids are pending again (release), and retry_after_failure
  // doesn't apply.
  function deferred(plan: Planned, hooks: PreparedHooks, reason: string): void {
    deps.runs.envs.settle(plan.runId, 'deferred', reason)
    hooks.end({ status: 'cancelled', outcome: `Deferred: ${reason}` }, { release: true })
  }

  // Stopped, or the run ended, once create may have made something (Ruling P2): never left preparing, so the run's
  // teardown deletes it now rather than at the next start. No hook runs: whatever ended the run closed it.
  function stopped(plan: Planned): void {
    deps.runs.envs.settle(plan.runId, 'failed', STOPPED)
  }

  async function afterCreate(
    plan: Planned,
    reply: PilotcliReply,
    signal: AbortSignal,
    hooks: PreparedHooks,
    repo: string
  ): Promise<void> {
    if (reply.outcome === 'not_yet') {
      deferred(plan, hooks, reply.reason)
      return
    }
    if (reply.outcome !== 'ok') {
      failed(plan, hooks, reply.reason || `pilotcli env create answered ${reply.outcome}`)
      return
    }
    let result: EnvResult
    let found: { id: string; path: string }
    try {
      result = parseEnvResult(reply.data)
      checkWhere(result, plan)
      found = await deps.resolvePath(repo, result.path, signal)
    } catch (error) {
      if (signal.aborted) {
        stopped(plan)
      } else {
        failed(plan, hooks, messageOf(error))
      }
      return
    }
    if (signal.aborted) {
      stopped(plan)
      return
    }
    // In place or kept, the folder is one of Nish's worktrees, and another Pilot run may be working in it (a branch or new
    // branch subject, where Pilot couldn't pass --throwaway). Never beside it: the run is deferred, as for not_yet. The look
    // and the record below are one synchronous step.
    const holder = result.mode === 'throwaway' ? null : holderOf(deps.runs, found.path, plan.runId)
    if (holder) {
      deferred(plan, hooks, heldFolderReason(holder, deps.nameOf, found.path))
      return
    }
    const home = result.mode === 'throwaway' ? plan.home : found.path
    const ready = { ...result, path: found.path, home, worktreeId: found.id }
    // False: the run ended while the folder was resolved.
    if (!deps.runs.envs.ready(plan.runId, ready)) {
      stopped(plan)
      return
    }
    if (result.mode === 'throwaway' && home) {
      await nestThrowaway(plan, found.id, home, result.sha)
    }
    await hooks.ready()
  }

  // Best effort: the sidebar's name for it never holds up or fails the run.
  async function nestThrowaway(
    plan: Planned,
    worktreeId: string,
    home: string,
    sha: string | null
  ): Promise<void> {
    try {
      await deps.nestThrowaway(worktreeId, home, throwawayLabel(plan.job, sha))
    } catch (error) {
      deps.log(
        `[pilot] run ${plan.runId}: couldn't nest its throwaway under ${home}: ${messageOf(error)}`
      )
    }
  }

  async function create(
    plan: Planned,
    args: string[],
    signal: AbortSignal,
    hooks: PreparedHooks,
    repo: string
  ): Promise<void> {
    const pidFile = deps.pidFile(plan.runId)
    let reply: PilotcliReply
    try {
      reply = await deps.pilotcli({ args, timeoutMs: CREATE_TIMEOUT_MS, signal, pidFile })
    } finally {
      rmSync(pidFile, { force: true })
    }
    if (signal.aborted) {
      stopped(plan)
      return
    }
    await afterCreate(plan, reply, signal, hooks, repo)
  }

  function begin(req: PrepareRequest, hooks: PreparedHooks): void {
    const runId = req.run.id
    // Subject and stack filled from the item's fields. A missing subject field or a stack that resolves to no stack throws
    // here: the run fails before anything is claimed or env create is called.
    const env = resolveEnv(req.env, req.fields, req.label)
    const home = throwawayHome(env, req.fields)
    const holder = holdsWorktree(env.subject)
      ? claimHome(deps.runs, runId, env.subject.worktree)
      : null
    const heldBy = holder ? throwawayReason(holder, deps.nameOf) : null
    const args = envCreateArgs({ runId, env, throwaway: heldBy, dryRun: false })
    deps.runs.envs.begin(runId, home, { args, preparer: deps.preparer() })
    const controller = new AbortController()
    const plan: Planned = { runId, job: deps.nameOf(req.run.automationId), home, heldBy }
    const done = create(plan, args, controller.signal, hooks, req.repo)
      .catch((error: unknown) =>
        deps.log(`[pilot] run ${runId}: preparing its workspace failed: ${messageOf(error)}`)
      )
      .finally(() => flights.delete(runId))
    flights.set(runId, { controller, done })
  }

  return {
    begin,
    isPreparing: (runId) => flights.has(runId),
    async stop(runId) {
      const flight = flights.get(runId)
      if (!flight) {
        return
      }
      flight.controller.abort()
      await flight.done
    },
    stopAll() {
      for (const flight of flights.values()) {
        flight.controller.abort()
      }
    },
    async settled() {
      while (flights.size > 0) {
        await Promise.all([...flights.values()].map((f) => f.done))
      }
    }
  }
}
