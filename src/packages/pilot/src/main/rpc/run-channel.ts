import type {
  RunChannelTarget,
  RunEventParams,
  RunEventResult,
  RunOutputParams,
  RunOutputResult,
  RunRow,
  StepRow
} from '../../shared/api-types'
import { homeOf } from '../../shared/api-types-env'
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
// Runs that still accept work; a finished, failed, timed-out or cancelled run takes nothing more.
const OPEN_RUN: readonly string[] = ['asking', 'running', 'needs_you']

// The env's step, only while it can still report: starting or running in a run still open, or detached.
function activeEnvStep(ctx: PilotContext, runId: string, stepIdx: number): StepRow {
  const run = ctx.store.runs.get(runId)
  if (!run) {
    throw new Error(`No run ${runId}`)
  }
  const step = ctx.store.runs.steps(runId).find((s) => s.idx === stepIdx)
  if (!step) {
    throw new Error(`Run ${runId} has no step ${stepIdx}`)
  }
  // A detached session outlives its step and its run.
  const active = step.status === 'starting' || step.status === 'running' || step.detached
  if (!active || (!step.detached && !OPEN_RUN.includes(run.status))) {
    throw new Error(
      `Step ${stepIdx} of run ${runId} has ended (step ${step.status}, run ${run.status}); it can't record anything more`
    )
  }
  return step
}

// The step a channel call is about: the one starting, running or detached on the caller's terminal. With several
// there (a step sent into an earlier step's terminal), the env's step wins when it is one of them. When
// none is bound, the env's PILOT_RUN_ID / PILOT_STEP_IDX, if that step is still active or detached.
function resolveStep(ctx: PilotContext, t: RunChannelTarget): { runId: string; stepIdx: number } {
  const bound = t.terminal ? ctx.store.runs.stepsOnTerminal(t.terminal) : []
  const named = bound.find((s) => s.runId === t.runId && s.idx === t.stepIdx)
  const chosen = named ?? bound[0]
  if (chosen) {
    return { runId: chosen.runId, stepIdx: chosen.idx }
  }
  if (t.runId && t.stepIdx !== undefined) {
    const step = activeEnvStep(ctx, t.runId, t.stepIdx)
    return { runId: step.runId, stepIdx: step.idx }
  }
  throw new Error(NOT_IN_STEP)
}

export function resolveChannelStep(
  ctx: PilotContext,
  t: RunChannelTarget
): { runId: string; stepIdx: number } {
  return resolveStep(ctx, t)
}

const OUTPUT_NOT_BOUND =
  "pilot run output works only from an agent step's own terminal: no agent step of a Pilot run is running on this terminal"

// pilot.run.output's step: only an agent step, and only one running on the caller's own terminal (the env's
// PILOT_RUN_ID / PILOT_STEP_IDX choose among the steps bound there, never stand in for one). A shell step's outputs
// come only from its $PILOT_OUTPUT_FILE, which Pilot reads when its process ends, so nothing can merge outputs into a
// shell step a later stage trusts (job.feeds … pass).
export function resolveOutputStep(
  ctx: PilotContext,
  t: RunChannelTarget
): { runId: string; stepIdx: number } {
  const bound = (t.terminal ? ctx.store.runs.stepsOnTerminal(t.terminal) : []).filter(
    (s) => s.kind !== 'shell'
  )
  const chosen = bound.find((s) => s.runId === t.runId && s.idx === t.stepIdx) ?? bound[0]
  if (!chosen) {
    throw new Error(OUTPUT_NOT_BOUND)
  }
  return { runId: chosen.runId, stepIdx: chosen.idx }
}

// The run alone (events need no step). Without a bound terminal the env's run must still be open.
export function resolveChannelRun(ctx: PilotContext, t: RunChannelTarget): string {
  const bound = t.terminal ? ctx.store.runs.stepsOnTerminal(t.terminal) : []
  const chosen = bound.find((s) => s.runId === t.runId) ?? bound[0]
  if (chosen) {
    return chosen.runId
  }
  if (t.runId) {
    const run = ctx.store.runs.get(t.runId)
    if (!run) {
      throw new Error(`No run ${t.runId}`)
    }
    if (!OPEN_RUN.includes(run.status)) {
      throw new Error(`Run ${t.runId} has ended (${run.status}); it can't record anything more`)
    }
    return run.id
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
  if (step.kind === 'shell') {
    throw new Error(
      `Step ${step.name} is a shell step: its outputs come only from its $PILOT_OUTPUT_FILE`
    )
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
    worktreePath: homeOf(run),
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
    worktreePath: homeOf(run),
    itemKey: run.itemKey,
    kind: p.kind,
    payload: p.payload ?? {}
  })
  return { id }
}
