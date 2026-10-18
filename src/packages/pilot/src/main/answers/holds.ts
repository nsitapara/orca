import type { HoldReason } from '../../shared/api-types'
import { QUOTA_CEILING } from '../../shared/quota-ceiling'
import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { QuotaReading } from '../fields/quota'
import {
  listBusyTerminals,
  runtimeBusyReads,
  worktreeBusy,
  type BusyRuntime,
  type BusyTerminal
} from '../fields/worktree-busy'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import { endedRunTerminals } from '../run/ended-run-tabs'
import type { PilotStore } from '../store/store'

export type HoldCode = HoldReason
// The two QueuePatch fields: the code, and the plain words the Inbox page shows.
export type Hold = { holdReason: HoldCode; holdDetail: string }

export function hold(code: HoldCode, words: string): Hold {
  return { holdReason: code, holdDetail: words }
}

export type WorktreeActivity = Awaited<ReturnType<typeof worktreeBusy>>
const NO_WORKTREE = hold('no_worktree', 'no worktree for this branch')

export type HoldDeps = {
  exists(path: string): boolean
  inFlight(path: string): Promise<string | null>
  activity(path: string): Promise<WorktreeActivity>
  // Pilot runs still working in the worktree, any automation (one agent per worktree).
  runsIn(path: string): { id: string }[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// apply.py holds()/busy(): why a worktree's answers can't be applied now, or null. Anything that can't be
// read counts as busy, so a failure never lets an answer in under running work.
export async function worktreeHold(path: string | null, deps: HoldDeps): Promise<Hold | null> {
  if (path === null) {
    return null
  }
  if (!deps.exists(path)) {
    return NO_WORKTREE
  }
  const running = deps.runsIn(path)[0]
  if (running) {
    return hold('worktree_busy', `run ${running.id} is working there`)
  }
  try {
    const flight = await deps.inFlight(path)
    if (flight) {
      return hold('in_flight', flight)
    }
  } catch (error) {
    return hold('in_flight', `git could not be read: ${messageOf(error)}`)
  }
  try {
    const busy = await deps.activity(path)
    if (busy) {
      return hold(busy.typing ? 'typing' : 'worktree_busy', busy.reason)
    }
    return null
  } catch (error) {
    return hold('worktree_busy', `its terminals could not be read: ${messageOf(error)}`)
  }
}

// An env automation's answers never wait for a busy worktree (M4 §8): Pilot passes --throwaway when its own run holds it,
// and pilotcli makes a throwaway when Nish is busy. Only a worktree that is gone holds them.
export async function answersHold(
  def: AutomationDefinition,
  path: string | null,
  deps: HoldDeps
): Promise<Hold | null> {
  if (def.workspace.kind !== 'env') {
    return worktreeHold(path, deps)
  }
  if (path !== null && !deps.exists(path)) {
    return NO_WORKTREE
  }
  return null
}

// gate.py in_flight over Task 5a's git facts (both read with optional locks off): uncommitted or
// untracked files, else a git operation in progress.
export function gitInFlight(
  facts: Pick<WorktreeFactDeps, 'gitStatus' | 'gitOperation'>
): (path: string) => Promise<string | null> {
  return async (path) => {
    const { dirty, untracked } = await facts.gitStatus(path)
    if (dirty + untracked > 0) {
      return 'uncommitted changes'
    }
    const operation = await facts.gitOperation(path)
    return operation ? `${operation} in progress` : null
  }
}

// One per dispatcher pass: terminals are listed and agent states read once, the first time a worktree
// needs them. A list that fails is shared too, so every worktree of the pass is held on it.
export function passActivity(
  runtime: BusyRuntime,
  store?: PilotStore
): (path: string) => Promise<WorktreeActivity> {
  const reads = runtimeBusyReads(runtime)
  let terminals: Promise<BusyTerminal[]> | null = null
  return async (path) => {
    terminals ??= listBusyTerminals(runtime)
    const listed = await terminals
    return worktreeBusy(path, listed, reads, store && endedRunTerminals(store, listed))
  }
}

// quota.py CEILING: automations leave the rest of each window for Nish's own sessions. Unknown passes.

export function quotaHold(agent: AgentKind, reading: QuotaReading): Hold | null {
  if (reading.weekly !== null && reading.weekly >= QUOTA_CEILING.weekly) {
    const at = Math.round(reading.weekly)
    return hold(
      'quota',
      `${agent} weekly limit at ${at}% (automations stop at ${QUOTA_CEILING.weekly}%)`
    )
  }
  if (reading.session !== null && reading.session >= QUOTA_CEILING.session) {
    const at = Math.round(reading.session)
    return hold(
      'quota',
      `${agent} session limit at ${at}% (automations stop at ${QUOTA_CEILING.session}%)`
    )
  }
  return null
}
