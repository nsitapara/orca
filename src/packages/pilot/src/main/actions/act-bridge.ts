import { runProcess } from '@orca/process-host'
import { engineChildEnv, type EngineEnv } from '../engine-env'

// What is left of the act.py bridge since its catalog entries moved to pilotcli (milestone 8): the action timeout
// push and mark_ready share, and the vault reader's way to spawn Pilot's Python helpers.

export type ProcessResultLike = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}
export type ProcessRun = (spec: {
  program: string
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}) => Promise<ProcessResultLike>

export const RUN_TIMEOUT_MS = 10 * 60_000

// A Python helper Pilot spawns must never route back into Pilot as a run's would (Task 22c), so it gets PILOT_BRIDGE=1
// and no PILOT_RUN_ID; AGENT_RUN tags its events with the run that asked. With the engine's env (H9) Pilot's bin folder
// leads PATH and its data folder is set, as for every engine child.
export function bridgeEnv(
  base: NodeJS.ProcessEnv,
  runId: string | null,
  engineEnv?: EngineEnv
): NodeJS.ProcessEnv {
  const engine = engineEnv ? engineChildEnv(engineEnv, {}, base) : {}
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...engine,
    PILOT_BRIDGE: '1',
    AGENT_RUN: runId ?? 'pilot'
  }
  delete env.PILOT_RUN_ID
  return env
}

// Used by the vault reader (Task 27b): one place spawns Pilot's Python helpers.
export const runWithProcessHost: ProcessRun = async (spec) => {
  const r = await runProcess({
    program: spec.program,
    args: spec.args,
    env: spec.env,
    timeoutMs: spec.timeoutMs
  })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut }
}
