import type { CommandHandler } from '../../../../cli/dispatch'
import {
  getOptionalJsonFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type { RunChannelTarget, RunEventResult, RunOutputResult } from '../shared/api-types'
import { parseOutputPairs } from '../shared/run/outputs'
import { invalid, jsonObjectFlag } from './cli-values'

export type StepTarget = { runId: string; stepIdx: number }

const NOT_IN_STEP =
  "Not inside a Pilot run's step: PILOT_RUN_ID and PILOT_STEP_IDX aren't set (Pilot sets them in every step it starts)"

// Pilot sets these in every step's terminal and shell process (contract §8).
export function stepFromEnv(env: NodeJS.ProcessEnv): StepTarget {
  const runId = env.PILOT_RUN_ID?.trim() ?? ''
  const raw = env.PILOT_STEP_IDX?.trim() ?? ''
  if (runId === '' || !/^\d+$/.test(raw)) {
    throw invalid(NOT_IN_STEP)
  }
  return { runId, stepIdx: Number(raw) }
}

// Ruling 8d: the terminal this command runs in (ORCA_TERMINAL_HANDLE) is what Pilot maps to the running
// step; the env's run and step are sent beside it as the fallback for when no step is bound there.
export function channelTarget(env: NodeJS.ProcessEnv): RunChannelTarget {
  const terminal = env.ORCA_TERMINAL_HANDLE?.trim() ?? ''
  const hasEnvStep =
    (env.PILOT_RUN_ID?.trim() ?? '') !== '' && /^\d+$/.test(env.PILOT_STEP_IDX?.trim() ?? '')
  if (terminal === '') {
    return stepFromEnv(env)
  }
  if (!hasEnvStep) {
    return { terminal }
  }
  return { terminal, ...stepFromEnv(env) }
}

export const RUN_HANDLERS: Record<string, CommandHandler> = {
  'run output': async ({ flags, client, json }) => {
    const target = channelTarget(process.env)
    const pairs = getRepeatedStringFlag(flags, 'pair')
    if (pairs.length === 0) {
      throw invalid('Give at least one <key>=<value>')
    }
    const parsed = parseOutputPairs(pairs)
    if (!parsed.ok) {
      throw invalid(parsed.errors.join('\n'))
    }
    const response = await client.call<RunOutputResult>('pilot.run.output', {
      ...target,
      outputs: parsed.outputs
    })
    printResult(
      response,
      json,
      (r) => `Recorded ${Object.keys(parsed.outputs).join(', ')} on step ${r.stepIdx} of ${r.runId}`
    )
  },
  'run event': async ({ flags, client, json }) => {
    const { terminal, runId } = channelTarget(process.env)
    const kind = getRequiredStringFlag(flags, 'kind')
    const payload = jsonObjectFlag(getOptionalJsonFlag(flags, 'payload'), 'payload')
    const response = await client.call<RunEventResult>('pilot.run.event', {
      ...(terminal ? { terminal } : {}),
      ...(runId ? { runId } : {}),
      kind,
      ...(payload ? { payload } : {})
    })
    printResult(response, json, (r) => `Recorded ${kind} (event ${r.id})`)
  }
}
