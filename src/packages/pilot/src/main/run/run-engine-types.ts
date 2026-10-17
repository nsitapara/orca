import type { ItemFields, RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import type { EnvPreparer } from '../envs/prepare'
import type { LaunchRequest } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import type { RunEndHandover } from './run-close'
import type { WorkspaceDeps } from './workspace'

// The run engine's contract (advance.ts): what it asks of a step starter and of its caller, and what it offers.
// A continued run's broken step, to resume in its own agent session (run-continue.ts); `reason` is why it broke.
export type ResumeStep = { idx: number; sessionId: string; reason: string }
export type StepStartRequest = {
  run: RunRow
  definition: AutomationDefinition
  idx: number
  // The item's fields, then the run's workspace, run.* and steps.*/previous.*: what templates read.
  fields: ItemFields
  resume?: ResumeStep
}
// Starts one step and returns once it is under way. It writes the step's row ('starting', then
// 'running'), or takes over the 'pending' row the engine wrote, and throws when the step couldn't
// start. The step's end reaches RunEngine.advance.
export type StepStarter = (req: StepStartRequest) => Promise<void>
export type RunEngineDeps = {
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  startStep: StepStarter
  // What startRun hands Task 8b's resolveWorkspace.
  workspace: WorkspaceDeps
  log(message: string): void
  // Called once when a run reaches its end status (Task 24c applies answer runs' outputs here).
  onRunEnd?(run: RunRow, end: RunEnd): void
  // What a stage's run hands the next stage, written in the transaction that ends it (main/handover).
  handover?: RunEndHandover
  // The answer text for {run.answer}: set for runs an answer starts, '' for a plain Approve, null
  // for any other run (Task 25 wires it).
  runAnswer?(run: RunRow): string | null
  // The label of the option that started an ask-first run, for {run.choice}; '' for any other run.
  runChoice?(run: RunRow): string
  // Env workspaces (main/envs): records the run as preparing and makes its env off the tick.
  envs?: EnvPreparer
}
export type RunEngine = {
  // The tick runner's launch. Writes step 0 as pending, resolves and records the workspace, then
  // starts the steps. Throws when no step could start, so the tick runner releases the item's
  // once_per key (or keeps it for an UnrecordedLaunchError). An env workspace is made off the tick:
  // startRun returns once it is under way, and the run's env hooks start or end it (advance-env.ts).
  startRun(req: LaunchRequest): Promise<void>
  // After a step ended: skip or start the next steps, or end the run. Never throws.
  advance(runId: string): Promise<void>
  // Running runs whose steps have all ended (Pilot quit between two steps, an advance that failed).
  advanceIdle(): Promise<void>
  // Walks a run run-continue.ts reopened, from its pending step; `resume` hands that step its old agent session.
  continueRun(runId: string, resume: ResumeStep | null): Promise<void>
}
