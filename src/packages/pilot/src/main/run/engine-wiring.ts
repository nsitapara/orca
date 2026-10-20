import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { EngineEnv } from '../engine-env'
import type { EnvPreparer } from '../envs/prepare'
import type { PilotStore } from '../store/store'
import {
  createRunEngine,
  runStepTimeoutMs,
  stepTimeoutMs,
  type RunEngine,
  type RunEngineDeps,
  type StepStarter,
  type StepStartRequest
} from './advance'
import { rememberLearnedSession } from './worktree-session'
import { claudeTranscriptCost, type CostReader } from './cost'
import {
  makeShellSteps,
  sweepOrphanShellSteps,
  type ShellRunner,
  type ShellSteps
} from './shell-step'
import { STALE_START_MS, sweepStaleStarts } from './stale-starts'
import { stepStarterFor } from './step-starters'
import { endsAtStart } from './step-wait'
import { holdHomeForStep } from '../envs/home-hold'
import { pollRunningSteps, type StepProbe } from './watcher'
import type { WorkspaceDeps } from './workspace'
import { stopCancelledPreparations } from './preparation-worker'

// A step whose definition was never loaded in this process times out this long after it was found missing.
export const MISSING_DEFINITION_TIMEOUT_MS = 60 * 60_000

export type ShellWiring = {
  // Where the step runs: the workspace 9b's startRun recorded on the run (run.worktreePath).
  workspaceOf(req: StepStartRequest): Promise<{ path: string }>
  // The §8 step env (Task 8c's pilotStepEnv).
  envOf(req: StepStartRequest): Record<string, string>
  // An env run's variables (pilotcli's data.env).
  runEnvOf?(req: StepStartRequest): Record<string, string>
  run?: ShellRunner
}
export type EngineWiringInput = {
  runtime: Pick<OrcaRuntimeService, 'closeTerminal'>
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  startAgentStep: StepStarter
  // What the engine's startRun hands Task 8b's resolveWorkspace.
  workspace: WorkspaceDeps
  // Pilot's bin folder and data folder for every shell command (H9).
  engineEnv: EngineEnv
  shell: ShellWiring
  probe: StepProbe
  cost?: CostReader
  log(message: string): void
  // Wired by Tasks 24c (answer runs' outputs) and 25 ({run.answer}); see RunEngineDeps.
  onRunEnd?: RunEngineDeps['onRunEnd']
  runAnswer?: RunEngineDeps['runAnswer']
  runChoice?: RunEngineDeps['runChoice']
  handover?: RunEngineDeps['handover']
  // A run's end or a swept start counted a failure on its key (the give-up card).
  failureCounted?: RunEngineDeps['failureCounted']
  // Env workspaces (main/envs): made off the tick; the sweep never closes the pending step of a run being prepared.
  envs?: EnvPreparer
}
export type WiredEngine = {
  engine: RunEngine
  shell: ShellSteps
  definitionFor(automationId: string): AutomationDefinition | null
  // Closes the starts a stopped process left (also at scheduler start); never a run this process is opening.
  sweep(): void
  poll(): Promise<void>
}

// The run engine and the scheduler's poll around it: close stale starts, watch running steps (ends,
// timeouts), then move on every run whose steps have all ended. Wire it once per process: the engine's
// one-walk-per-run lock and the set of runs being opened live in this instance.
export function wireRunEngine(input: EngineWiringInput): WiredEngine {
  const { store, now, log } = input
  let advance: (runId: string) => Promise<void> = async () => {}
  const shell = makeShellSteps({
    store,
    now,
    log,
    workspaceOf: input.shell.workspaceOf,
    envOf: input.shell.envOf,
    runEnvOf: input.shell.runEnvOf,
    engineEnv: input.engineEnv,
    run: input.shell.run,
    timeoutOf: (req) => stepTimeoutMs(req.definition, req.idx),
    holdHome: (req) =>
      req.definition.steps[req.idx].holdHome
        ? holdHomeForStep(store.runs, req.run, req.idx, (id) => input.definitionFor(id)?.name ?? id)
        : null,
    releaseHome: (req) => store.runs.envs.releaseHome(req.run.id, req.idx),
    onEnded: (runId) => void advance(runId)
  })
  const inner = createRunEngine({
    store,
    now,
    definitionFor: input.definitionFor,
    startStep: stepStarterFor({ agent: input.startAgentStep, shell: shell.start }),
    workspace: input.workspace,
    log,
    onRunEnd: input.onRunEnd,
    runAnswer: input.runAnswer,
    runChoice: input.runChoice,
    handover: input.handover,
    failureCounted: input.failureCounted,
    envs: input.envs
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
  advance = (runId) => engine.advance(runId)
  // The last definition seen for each automation, and when one first went missing: a removed or broken
  // file must not strip a running step of its timeout, nor let it hold its worktree for ever.
  const lastKnown = new Map<string, AutomationDefinition>()
  const missingSince = new Map<string, number>()
  const timeoutOf = (step: {
    runId: string
    idx: number
    startedAt: number | null
  }): number | null => {
    const run = store.runs.get(step.runId)
    if (!run) {
      return null
    }
    const loaded = input.definitionFor(run.automationId)
    if (loaded) {
      lastKnown.set(run.automationId, loaded)
      missingSince.delete(run.automationId)
    }
    const def = loaded ?? lastKnown.get(run.automationId)
    if (def) {
      return runStepTimeoutMs(def, run, step.idx)
    }
    // Never known in this process: the default hour, counted from when it was first found missing.
    const since = missingSince.get(run.automationId) ?? now()
    missingSince.set(run.automationId, since)
    return Math.max(since - (step.startedAt ?? since), 0) + MISSING_DEFINITION_TIMEOUT_MS
  }
  const endsAtStartOf = (step: { runId: string; idx: number }): boolean => {
    const run = store.runs.get(step.runId)
    if (!run) {
      return false
    }
    const def = input.definitionFor(run.automationId) ?? lastKnown.get(run.automationId) ?? null
    return endsAtStart(def, run, step.idx)
  }
  const sweep = (): void =>
    sweepStaleStarts(store, now, log, {
      olderThanMs: STALE_START_MS,
      opening: (runId) => opening.has(runId) || (input.envs?.isPreparing(runId) ?? false),
      failureCounted: input.failureCounted,
      asksFirst: (id) => input.definitionFor(id)?.start === 'ask_first'
    })
  return {
    engine,
    shell,
    definitionFor: input.definitionFor,
    sweep,
    async poll() {
      await stopCancelledPreparations({
        store,
        now,
        log,
        definitionFor: input.definitionFor,
        closeTerminal: async (handle) => {
          const closed = await input.runtime.closeTerminal(handle)
          if (closed.ptyStopVerdict) {
            throw new Error(`Couldn't stop preparation terminal: ${closed.ptyStopVerdict}`)
          }
        }
      })
      store.transaction(() => store.inboxPreparations.recoverExpired(now()))
      sweep()
      sweepOrphanShellSteps(store, shell.isLive, now, log)
      await pollRunningSteps(store, input.probe, input.cost ?? claudeTranscriptCost, now, {
        timeoutOf,
        endsAtStart: endsAtStartOf,
        log,
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
        onStepEnded: (runId) => engine.advance(runId),
        sessionLearned: (step, sessionId) =>
          rememberLearnedSession(store, input.definitionFor, step, sessionId, now())
      })
      await engine.advanceIdle()
    }
  }
}
