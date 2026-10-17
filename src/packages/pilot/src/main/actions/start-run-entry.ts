import type { ItemDecision, RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { UnrecordedLaunchError, type LaunchRequest } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import { actionDone, actionFailed, type ActionEntry } from './types'
import { repend } from '../handover/repend'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The decision the run's tick recorded for its item, now `started`: what the engine launches from.
function decisionOf(store: PilotStore, run: RunRow): ItemDecision | null {
  const { tickId, itemKey } = run
  const row = tickId === null ? null : store.tickItems(tickId).find((i) => i.itemKey === itemKey)
  if (!row) {
    return null
  }
  return {
    key: row.itemKey,
    label: row.label,
    verdict: 'started',
    reason: row.reason,
    checks: row.checks,
    onceKey: store.handledRows(run.automationId).find((r) => r.runId === run.id)?.onceKey ?? '',
    fields: row.fields
  }
}

// Approve on an ask-first card. Power null: the catalog never runs it without a person's approval.
export function startRunEntry(deps: {
  store: PilotStore
  now(): number
  definitions(): AutomationDefinition[]
  // RunEngine.startRun (Task 9b).
  start(req: LaunchRequest): Promise<unknown>
  // Only the process that runs the scheduler starts a run: its engine watches and ends it.
  schedulerOn(): boolean
  // Automations whose file is invalid, shown from their last valid version only (loader displayOnly).
  displayOnly(): readonly string[]
  // The run limit (main/capacity): an approved run waits for a free slot, its card's answer held until one frees.
  hasFreeSlot?(definition: AutomationDefinition): boolean
}): ActionEntry {
  return {
    name: 'start_run',
    power: null,
    label: 'Start a run that asked first',
    usage: 'start_run { "run_id" }',
    checkArgs: (args) => {
      const only = Object.keys(args).length === 1
      return only && typeof args.run_id === 'string' && args.run_id !== ''
        ? null
        : 'usage: start_run { "run_id" }'
    },
    describe: async (args) => `Start run ${String(args.run_id ?? '')}`,
    run: async (args, opts) => {
      const { dryRun } = opts
      const runId = typeof args.run_id === 'string' ? args.run_id : ''
      if (!runId) {
        return actionFailed('usage: start_run { "run_id" }')
      }
      const run = deps.store.runs.get(runId)
      if (!run) {
        return actionFailed(`No run ${runId}`)
      }
      if (run.status !== 'asking') {
        return {
          outcome: 'stale',
          detail: `run ${run.id} is ${run.status}`,
          link: null,
          log: null,
          onYou: false
        }
      }
      const definition = deps.definitions().find((d) => d.id === run.automationId)
      const decision = decisionOf(deps.store, run)
      if (!definition || !decision) {
        return actionFailed(`Run ${run.id} has no recorded tick to start from`)
      }
      // Fail closed: a held-back definition is for display; nothing new starts from it.
      if (deps.displayOnly().includes(run.automationId)) {
        return actionFailed(
          `${run.automationId} has an invalid definition; fix it before starting runs`
        )
      }
      if (dryRun) {
        return actionDone(`would start run ${run.id}`)
      }
      if (!deps.schedulerOn()) {
        return actionFailed(SCHEDULER_OFF)
      }
      // Only the run's own card starts it: a card an agent filed naming another run never does.
      if (opts.runId !== run.id) {
        return actionFailed(`start_run only runs from the card of run ${run.id}`)
      }
      if (deps.hasFreeSlot && !deps.hasFreeSlot(definition)) {
        return {
          outcome: 'not_yet',
          detail: 'every run slot is taken',
          link: null,
          log: null,
          onYou: false
        }
      }
      deps.store.runs.update(run.id, { status: 'running' })
      try {
        await deps.start({ runId: run.id, definition, decision })
      } catch (error) {
        deps.store.runs.update(run.id, {
          status: 'failed',
          outcome: `Couldn't start: ${messageOf(error)}`,
          finishedAt: deps.now()
        })
        repend(deps.store, run.id)
        // Nothing started, so the item's key is freed and its head can be offered again; an agent left
        // running untracked keeps it, so no tick starts a second one beside it.
        if (!(error instanceof UnrecordedLaunchError)) {
          deps.store.unmarkHandledForRun(run.automationId, run.id)
        }
        return actionFailed(`Couldn't start run ${run.id}: ${messageOf(error)}`)
      }
      return actionDone(`started run ${run.id}`)
    }
  }
}
