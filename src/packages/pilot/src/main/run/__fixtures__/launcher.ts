import type { LaunchRequest, LaunchResult } from '../../scheduler/tick-runner'
import type { PilotStore } from '../../store/store'
import { stepKindOf } from '../../store/store-advance'
import { runFields } from '../../../shared/template'
import { launchAgentStep, type AgentStepRequest } from '../agent-step'
import type { LauncherDeps } from '../launch'
import { resolveWorkspace, type Workspace } from '../workspace'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Best effort: the failure being reported matters more than a second failure while recording it.
function failFirstStep(store: PilotStore, runId: string, error: string, at: number): void {
  try {
    store.runs.updateStep(runId, 0, { status: 'failed', error, finishedAt: at })
  } catch {}
}

// Tests only: a single-step launch (production launches through the run engine's startRun,
// run/engine-wiring.ts). Writes step 0 as `pending` (B8: a slow worktree create must
// not look like a stuck start) stamped now, as the engine does; resolves the run's workspace (item
// worktree, main checkout or a new worktree), records it on the run, then starts step 0 (spec §7). The
// tick runner created the run row (running) first, so a new worktree's claim sees it. A workspace
// failure fails the step with its error; the tick runner then fails the run and frees its key.
export function makeLauncher(
  store: PilotStore,
  deps: LauncherDeps
): (req: LaunchRequest) => Promise<LaunchResult> {
  return async ({ runId, definition, decision }) => {
    const startedAt = store.runs.get(runId)?.startedAt ?? deps.now()
    const fields = {
      ...decision.fields,
      ...runFields({
        automationId: definition.id,
        at: startedAt,
        timezone: definition.timezone,
        runId
      })
    }
    const first = definition.steps[0]
    store.runs.createStep({
      runId,
      idx: 0,
      name: first.name,
      agent: first.agent,
      skill: first.skill,
      startedAt: deps.now(),
      status: 'pending',
      kind: stepKindOf(first.agent),
      mode: first.mode,
      whenExpr: first.when
    })
    const startShell = deps.startShellStep
    // Before the workspace: a run that can't start must not leave a new worktree behind.
    if (first.agent === 'shell' && !startShell) {
      const message = `Step "${first.name}" is a shell step, and this launcher has no shell runner`
      failFirstStep(store, runId, message, deps.now())
      throw new Error(message)
    }
    let workspace: Workspace
    try {
      workspace = await resolveWorkspace(
        { definition, runId, label: decision.label, fields },
        deps.workspace
      )
      store.runs.update(runId, { worktreePath: workspace.path, worktreeId: workspace.worktreeId })
    } catch (error) {
      failFirstStep(store, runId, messageOf(error), deps.now())
      throw error
    }
    const req: AgentStepRequest = {
      runId,
      definition,
      stepIdx: 0,
      itemKey: decision.key,
      label: decision.label,
      fields,
      workspace
    }
    if (first.agent === 'shell' && startShell) {
      return startShell(req)
    }
    return launchAgentStep(store, req, deps)
  }
}
