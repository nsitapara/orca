import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import { PreparationStaleError } from '../store/store-inbox-preparations'
import type { AgentStepRequest } from './agent-step'
import { NothingToDoError } from './nothing-to-do'
import { closeRun } from './run-close'

// Called after asynchronous launch preparation, immediately before sending the prompt/spawning. A card with nothing
// left for this run (answered, prepared, or someone else's) stops the step: the run had nothing to do.
export function claimPreparationWorker(store: PilotStore, req: AgentStepRequest, at: number): void {
  if (req.definition.items?.kind !== 'inbox_preparation') {
    return
  }
  const revision = req.fields['preparation.revision']
  if (req.fields['preparation.item_id'] !== req.itemKey || typeof revision !== 'number') {
    throw new Error('Preparation worker is missing its item/revision binding')
  }
  try {
    store.transaction(() =>
      store.inboxPreparations.claim(req.itemKey, revision, req.runId, req.stepIdx, at)
    )
  } catch (error) {
    if (error instanceof PreparationStaleError && error.nothingToDo) {
      throw new NothingToDoError(error.reason)
    }
    throw error
  }
}

// A process exists but no step can watch it. Do not give a replacement the same checkout.
export function blockUntrackedPreparation(
  store: PilotStore,
  req: AgentStepRequest,
  reason: string,
  at: number
): void {
  if (req.definition.items?.kind !== 'inbox_preparation') {
    return
  }
  store.transaction(() => {
    const p = store.inbox.get(req.itemKey)?.preparation
    if (p?.runId !== req.runId || p.state !== 'generating') {
      return
    }
    store.inboxPreparations.write(req.itemKey, {
      ...p,
      state: 'blocked',
      leaseUntil: null,
      updatedAt: at,
      error: reason,
      progress: 'Untracked worker: stop its terminal before retrying'
    })
  })
}

export function preparationStopReason(store: PilotStore, run: RunRow, at: number): string | null {
  const item = store.inbox.get(run.itemKey)
  const p = item?.preparation
  if (!item || item.status !== 'open' || item.answer) {
    return 'Item was answered or closed; context preparation stopped'
  }
  if (!p || p.runId !== run.id) {
    return 'Preparation attempt was superseded'
  }
  if (p.state === 'ready') {
    return null
  }
  if (p.state !== 'generating' || !store.inboxPreparations.holds(p, at)) {
    return 'Preparation claim ended or expired'
  }
  return null
}

// Stop the owned agent before releasing its run/worktree. Failed terminal closes retry next poll.
export async function stopCancelledPreparations(deps: {
  store: PilotStore
  now(): number
  definitionFor(id: string): AutomationDefinition | null
  closeTerminal(handle: string): Promise<unknown>
  log(message: string): void
}): Promise<void> {
  const ids = new Set(deps.store.runs.runningSteps().map((step) => step.runId))
  for (const id of ids) {
    const run = deps.store.runs.get(id)
    if (!run || run.status !== 'running') {
      continue
    }
    if (deps.definitionFor(run.automationId)?.items?.kind !== 'inbox_preparation') {
      continue
    }
    const steps = deps.store.runs.steps(run.id)
    if (!steps.some((s) => s.status === 'running')) {
      continue
    }
    const reason = preparationStopReason(deps.store, run, deps.now())
    if (!reason) {
      continue
    }
    try {
      for (const step of steps.filter((s) => s.status === 'running' || s.status === 'starting')) {
        if (step.kind === 'shell') {
          throw new Error('Waiting for the preparation shell step to finish')
        }
        if (step.terminalHandle) {
          await deps.closeTerminal(step.terminalHandle)
        }
        deps.store.runs.updateStep(run.id, step.idx, {
          status: 'skipped',
          error: reason,
          finishedAt: deps.now()
        })
      }
      closeRun(deps, run, { status: 'cancelled', outcome: reason })
    } catch (error) {
      deps.log(`[pilot] context preparation ${run.id}: ${String(error)}`)
    }
  }
}
