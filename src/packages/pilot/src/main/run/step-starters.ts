import type { LaunchResult } from '../scheduler/tick-runner'
import type { StepStarter, StepStartRequest } from './advance'
import type { AgentStepRequest } from './agent-step'
import type { Workspace } from './workspace'

// Task 8d's launchAgentStep, bound to its deps by the caller (pilot-services).
export type AgentStepLauncher = (req: AgentStepRequest) => Promise<LaunchResult>

// The workspace the engine recorded on the run (9b's startRun, from Task 8b's resolveWorkspace).
function recordedWorkspace(req: StepStartRequest): Workspace {
  const { run } = req
  if (!run.worktreePath) {
    throw new Error(`Run ${run.id} has no workspace`)
  }
  const selector = run.worktreeId ? `id:${run.worktreeId}` : `path:${run.worktreePath}`
  return {
    kind: req.definition.workspace.kind,
    path: run.worktreePath,
    worktreeId: run.worktreeId,
    selector,
    created: false
  }
}

// Agent steps start through launchAgentStep (Task 8d): it takes over the `pending` row the engine
// wrote for step 0 or creates the row, and reads the mode text through its own deps.
export function agentStepStarter(launch: AgentStepLauncher): StepStarter {
  return async (req) => {
    await launch({
      runId: req.run.id,
      definition: req.definition,
      stepIdx: req.idx,
      itemKey: req.run.itemKey,
      label: req.run.itemLabel,
      fields: req.fields,
      workspace: recordedWorkspace(req)
    })
  }
}

export function stepStarterFor(starters: { agent: StepStarter; shell: StepStarter }): StepStarter {
  return (req) => {
    if (req.definition.steps[req.idx].agent === 'shell') {
      return starters.shell(req)
    }
    return starters.agent(req)
  }
}
