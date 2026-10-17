import type { ItemFields } from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'
import { kbOf, RESULT_FIELD_CAP_BYTES, utf8Bytes } from '../../shared/run/step-result'
import { placeholderNames } from '../../shared/template'
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
    created: false,
    env: run.env?.vars ?? {},
    disposable: run.env?.mode === 'throwaway'
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
      workspace: recordedWorkspace(req),
      ...(req.resume ? { resume: req.resume } : {})
    })
  }
}

const RESULT_FIELD = /^(?:steps\.\w+|previous)\.result$/

// The 32 KB cap on {steps.<name>.result} and {previous.result} where a step renders one: its prompt or its env: values.
// Never truncated: the step fails, naming the size (UTF-8 bytes).
export function resultCapError(
  step: Pick<StepDef, 'prompt' | 'env'>,
  fields: ItemFields
): string | null {
  const templates = [step.prompt ?? '', ...Object.values(step.env)]
  for (const name of templates.flatMap((template) => placeholderNames(template))) {
    const value = fields[name]
    if (!RESULT_FIELD.test(name) || typeof value !== 'string') {
      continue
    }
    const bytes = utf8Bytes(value)
    if (bytes > RESULT_FIELD_CAP_BYTES) {
      return `${name} is ${kbOf(bytes)} KB, over the 32 KB cap`
    }
  }
  return null
}

// Every step starts here (engine-wiring.ts:97), so the cap holds for both kinds. A step it refuses fails like any step
// that couldn't start (advance.ts start()).
export function stepStarterFor(starters: { agent: StepStarter; shell: StepStarter }): StepStarter {
  return async (req) => {
    const step = req.definition.steps[req.idx]
    const over = resultCapError(step, req.fields)
    if (over) {
      throw new Error(over)
    }
    if (step.agent === 'shell') {
      return starters.shell(req)
    }
    return starters.agent(req)
  }
}
