import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import {
  createRunEngine,
  stepTimeoutMs,
  type RunEngine,
  type RunEngineDeps,
  type StepStarter
} from './advance'
import { claudeTranscriptCost, type CostReader } from './cost'
import { STALE_START_MS, sweepStaleStarts } from './stale-starts'
import { stepStarterFor, unsupportedShellStep } from './step-starters'
import { pollRunningSteps, type StepProbe } from './watcher'
import type { WorkspaceDeps } from './workspace'

export type EngineWiringInput = {
  runtime: Pick<OrcaRuntimeService, 'closeTerminal'>
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  startAgentStep: StepStarter
  // What the engine's startRun hands Task 8b's resolveWorkspace.
  workspace: WorkspaceDeps
  probe: StepProbe
  cost?: CostReader
  log(message: string): void
  // Wired by Tasks 24c (answer runs' outputs) and 25 ({run.answer}); see RunEngineDeps.
  onRunEnd?: RunEngineDeps['onRunEnd']
  runAnswer?: RunEngineDeps['runAnswer']
}
export type WiredEngine = { engine: RunEngine; poll(): Promise<void> }

// The run engine and the scheduler's poll around it: close stale starts, watch running steps (ends,
// timeouts), then move on every run whose steps have all ended. Wire it once per process: the engine's
// one-walk-per-run lock and the set of runs being opened live in this instance.
export function wireRunEngine(input: EngineWiringInput): WiredEngine {
  const { store, now, log } = input
  const inner = createRunEngine({
    store,
    now,
    definitionFor: input.definitionFor,
    startStep: stepStarterFor({ agent: input.startAgentStep, shell: unsupportedShellStep() }),
    workspace: input.workspace,
    log,
    onRunEnd: input.onRunEnd,
    runAnswer: input.runAnswer
  })
  // Runs whose startRun is still going (B8: making the workspace): the sweep never closes their pending step.
  const opening = new Set<string>()
  const engine: RunEngine = {
    ...inner,
    async startRun(req) {
      opening.add(req.runId)
      try {
        await inner.startRun(req)
      } finally {
        opening.delete(req.runId)
      }
    }
  }
  const timeoutOf = (step: { runId: string; idx: number }): number | null => {
    const run = store.runs.get(step.runId)
    const def = run ? input.definitionFor(run.automationId) : null
    return def ? stepTimeoutMs(def, step.idx) : null
  }
  return {
    engine,
    async poll() {
      sweepStaleStarts(store, now, log, STALE_START_MS, (runId) => opening.has(runId))
      await pollRunningSteps(store, input.probe, input.cost ?? claudeTranscriptCost, now, {
        timeoutOf,
        // As launch.ts's closeSessionTerminal: a process the close couldn't stop is a failed close, so
        // the step stays running (no next step starts beside a live agent) and the next poll retries.
        closeTerminal: async (handle) => {
          const closed = await input.runtime.closeTerminal(handle)
          if (closed.ptyStopVerdict) {
            throw new Error(
              `Couldn't close terminal ${handle}: its process is ${closed.ptyStopVerdict}`
            )
          }
        },
        onStepEnded: (runId) => engine.advance(runId)
      })
      await engine.advanceIdle()
    }
  }
}
