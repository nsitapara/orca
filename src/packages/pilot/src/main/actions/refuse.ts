import { actionFailed, type ActionResult } from './types'
import type { PilotStore } from '../store/store'
import { argsDigest } from './powers'
import type { AttemptResult } from './attempt'

// What an attempt's action_runs rows say about it.
export type Row = {
  action: string
  dryRun: boolean
  runId: string | null
  inboxItemId: string | null
  approved: boolean
  digest?: string
}

export function startRow(
  deps: { store: PilotStore; now(): number },
  row: Row,
  args: Record<string, unknown>
): number {
  return deps.store.actions.start({
    inboxItemId: row.inboxItemId,
    runId: row.runId,
    action: row.action,
    args,
    digest: row.digest ?? argsDigest(row.action, args),
    phase: 'do',
    dryRun: row.dryRun,
    startedAt: deps.now()
  })
}

// An attempt turned away is still an action_runs row (contract §10), with why in its output.
export function refused<R extends AttemptResult>(
  deps: { store: PilotStore; now(): number },
  row: Row,
  args: Record<string, unknown>,
  result: R
): R {
  const id = startRow(deps, row, args)
  deps.store.actions.finish(id, 'refused', JSON.stringify(result), deps.now())
  return result
}

// A call refused before it is an attempt (who is calling, or which run it is, can't be told): still a row.
export function refuseCall(
  deps: { store: PilotStore; now(): number },
  call: { action: string; args: Record<string, unknown>; dryRun: boolean },
  detail: string
): ActionResult {
  const row = { ...call, runId: null, inboxItemId: null, approved: false }
  return refused(deps, row, call.args, actionFailed(detail))
}

// Pilot's own ask about an action, outside a run's attempt (ask_first files its card itself): the refused
// `asked` row under the card (powers.ts askedByPilot).
export function recordPilotAsk(
  deps: { store: PilotStore; now(): number },
  row: Pick<Row, 'action' | 'runId' | 'inboxItemId'>,
  args: Record<string, unknown>,
  detail: string
): void {
  const asked = { ...row, dryRun: false, approved: false }
  refused(deps, asked, args, { outcome: 'asked', detail, inboxItemId: row.inboxItemId })
}
