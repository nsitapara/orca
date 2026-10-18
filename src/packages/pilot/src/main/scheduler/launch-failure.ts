import type { AutomationDefinition } from '../../shared/definition/types'
import { usesHandled } from '../../shared/tick/decide'
import { leaveGiveUpCard } from '../capacity/give-up'
import { repend } from '../handover/repend'
import type { InboxDeps } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'

// A run the tick created whose launch hasn't settled.
export type Unlaunched = { runId: string; onceKey: string; itemKey: string; itemLabel: string }
type LaunchDeps = { store: PilotStore; now(): number; ask: { inbox: InboxDeps } }

// Best effort: one failing cleanup call must not mask the others. The key counts a failure, so the runner retries it
// after a wait and gives up past the retry limit; a run the stale-start sweep failed meanwhile counted it there.
export function releaseUnlaunched(
  def: AutomationDefinition,
  u: Unlaunched,
  message: string,
  deps: LaunchDeps
): void {
  const outcome = `Couldn't start: ${message}`
  let running = true
  try {
    running = deps.store.runs.get(u.runId)?.status === 'running'
    deps.store.runs.update(u.runId, { status: 'failed', outcome, finishedAt: deps.now() })
    repend(deps.store, u.runId)
  } catch {}
  if (!usesHandled(def) || !running) {
    return
  }
  try {
    const failures = deps.store.setHandledStatus(def.id, u.runId, 'failed', deps.now())
    leaveGiveUpCard(deps.ask.inbox, def, { ...u, outcome }, failures)
  } catch {}
}

// The agent is running in a terminal no step tracks, so its key stays handled (marked again, in case
// the stale-start sweep failed it during a slow launch) and no later tick starts a second agent on the
// item. The run is failed, and its outcome names the terminal.
export function keepOrphanHandled(
  def: AutomationDefinition,
  u: Unlaunched,
  message: string,
  deps: LaunchDeps
): void {
  const at = deps.now()
  try {
    deps.store.runs.update(u.runId, { status: 'failed', outcome: message, finishedAt: at })
    repend(deps.store, u.runId)
  } catch {}
  if (!usesHandled(def)) {
    return
  }
  try {
    deps.store.markHandled(def.id, u.onceKey, u.runId, at)
  } catch {}
}
