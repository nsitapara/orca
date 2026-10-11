import type {
  RunChannelTarget,
  RunEventParams,
  RunEventResult,
  RunOutputParams,
  RunOutputResult,
  RunRow,
  StepRow
} from '../../shared/api-types'
import type { PilotContext } from '../pilot-services'
import { readMode } from '../run/modes'

// Outputs the engine itself reads (the run's summary, an answer run's report): no mode has to declare them.
export const RESERVED_OUTPUTS = ['summary', 'outcome', 'item_status', 'reply']

export type ModeOutputsReader = (
  skill: string,
  mode: string,
  workspacePath: string | null
) => { outputs: string[] | null }

const NOT_IN_STEP =
  "Not inside a Pilot run's step: this terminal has no running Pilot step, and PILOT_RUN_ID and PILOT_STEP_IDX aren't set"

// The (run, step) a channel call is about: the step starting or running on the caller's terminal; only
// when none is bound there, the env's PILOT_RUN_ID / PILOT_STEP_IDX (a step sent into an earlier
// step's terminal records against itself, not the earlier one).
export function resolveChannelStep(
  ctx: PilotContext,
  t: RunChannelTarget
): { runId: string; stepIdx: number } {
  const bound = t.terminal ? ctx.store.runs.stepOnTerminal(t.terminal) : null
  if (bound) {
    return { runId: bound.runId, stepIdx: bound.idx }
  }
  if (t.runId && t.stepIdx !== undefined) {
    return { runId: t.runId, stepIdx: t.stepIdx }
  }
  throw new Error(NOT_IN_STEP)
}

// The run alone (events need no step): the terminal's step's run, else the env's.
export function resolveChannelRun(ctx: PilotContext, t: RunChannelTarget): string {
  const bound = t.terminal ? ctx.store.runs.stepOnTerminal(t.terminal) : null
  if (bound) {
    return bound.runId
  }
  if (t.runId) {
    return t.runId
  }
  throw new Error(NOT_IN_STEP)
}

function runOf(ctx: PilotContext, runId: string): RunRow {
  const run = ctx.store.runs.get(runId)
  if (!run) {
    throw new Error(`No run ${runId}`)
  }
  return run
}

// What the step's mode declares; null when it declares nothing or can't be read right now (an
// unreadable mode file must not lose what the agent reported).
function declaredOutputs(run: RunRow, step: StepRow, read: ModeOutputsReader): string[] | null {
  if (!step.mode || !step.skill) {
    return null
  }
  try {
    return read(step.skill, step.mode, run.worktreePath).outputs
  } catch {
    return null
  }
}

function refuseUndeclared(
  step: StepRow,
  declared: string[],
  outputs: RunOutputParams['outputs']
): void {
  const undeclared = Object.keys(outputs).filter(
    (key) => !RESERVED_OUTPUTS.includes(key) && !declared.includes(key)
  )
  if (undeclared.length === 0) {
    return
  }
  const allowed = declared.length > 0 ? declared.join(', ') : 'no outputs'
  throw new Error(
    `Step ${step.name} (mode ${step.mode}) declares ${allowed}; ${undeclared.join(', ')} isn't one of them`
  )
}

// pilot.run.output: merges into the step's outputs (later steps read them as steps.<step>.<name>).
export function recordRunOutput(
  ctx: PilotContext,
  p: RunOutputParams,
  read: ModeOutputsReader = readMode,
  now: () => number = Date.now
): RunOutputResult {
  const run = runOf(ctx, p.runId)
  const step = ctx.store.runs.steps(run.id).find((s) => s.idx === p.stepIdx)
  if (!step) {
    throw new Error(`Run ${run.id} has no step ${p.stepIdx}`)
  }
  const declared = declaredOutputs(run, step, read)
  if (declared !== null) {
    refuseUndeclared(step, declared, p.outputs)
  }
  const outputs = ctx.store.advance.mergeStepOutputs(run.id, step.idx, p.outputs)
  ctx.store.events.add({
    at: now(),
    automationId: run.automationId,
    runId: run.id,
    worktreePath: run.worktreePath,
    itemKey: run.itemKey,
    kind: 'step_output',
    payload: { step: step.name, outputs: p.outputs }
  })
  return { runId: run.id, stepIdx: step.idx, outputs }
}

// pilot.run.event: anything an agent wants on the run's timeline (pushed, posted, …).
export function recordRunEvent(
  ctx: PilotContext,
  p: RunEventParams,
  now: () => number = Date.now
): RunEventResult {
  const run = runOf(ctx, p.runId)
  const id = ctx.store.events.add({
    at: now(),
    automationId: run.automationId,
    runId: run.id,
    worktreePath: run.worktreePath,
    itemKey: run.itemKey,
    kind: p.kind,
    payload: p.payload ?? {}
  })
  return { id }
}
