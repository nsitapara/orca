import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PilotStore } from '../store/store'
import type { MeasurableStep } from '../store/store-usage'
import type { UsageBucket } from './buckets'
import { claudeSubagentFiles, claudeUsage, findClaudeTranscript } from './claude'
import { codexUsage, findCodexRollout } from './codex'

export type StepUsage = { buckets: UsageBucket[]; sessionFound: boolean }
export type StepUsageReader = (step: MeasurableStep) => Promise<StepUsage>
export type UsagePaths = { claudeProjects: string; codexHomes: string[] }

// A transcript can land a moment after the Stop hook. Until then a step with a session id waits; after this
// long it is recorded with no usage, which the report lists as a gap.
export const MEASURE_RETRY_MS = 10 * 60_000

const NOT_FOUND: StepUsage = { buckets: [], sessionFound: false }

export function defaultUsagePaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): UsagePaths {
  const claudeDir = env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude')
  const codexHomes = [env.CODEX_HOME?.trim(), join(home, '.codex')].filter((d): d is string =>
    Boolean(d)
  )
  return { claudeProjects: join(claudeDir, 'projects'), codexHomes }
}

export function stepUsageReader(paths: UsagePaths, now: () => number): StepUsageReader {
  return async (step) => {
    if (!step.sessionId || step.startedAt === null) {
      return NOT_FOUND
    }
    const window = { from: step.startedAt, to: step.finishedAt ?? now() }
    if (step.agent === 'claude') {
      const main = await findClaudeTranscript(
        step.sessionId,
        step.transcriptPath,
        paths.claudeProjects
      )
      if (!main) {
        return NOT_FOUND
      }
      return {
        buckets: await claudeUsage([main, ...(await claudeSubagentFiles(main))], window),
        sessionFound: true
      }
    }
    if (step.agent === 'codex') {
      const rollout = await findCodexRollout(
        step.sessionId,
        step.transcriptPath,
        step.startedAt,
        paths.codexHomes
      )
      if (!rollout) {
        return NOT_FOUND
      }
      return { buckets: await codexUsage(rollout, window), sessionFound: true }
    }
    return NOT_FOUND
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Called after every poll. Each agent step that ended is read once, inside its own window, so a session a later
// step or answer run resumes is never counted twice. One step's failure never stops the others.
export async function measureFinishedSteps(
  store: PilotStore,
  read: StepUsageReader,
  now: () => number,
  log: (message: string) => void
): Promise<number> {
  let measured = 0
  for (const step of store.usage.unmeasuredSteps()) {
    try {
      const usage = await read(step)
      const waiting =
        !usage.sessionFound &&
        step.sessionId !== null &&
        now() - (step.finishedAt ?? 0) < MEASURE_RETRY_MS
      if (waiting) {
        continue
      }
      store.usage.saveStepUsage(step.runId, step.idx, usage.buckets, usage.sessionFound, now())
      store.usage.rollupRun(step.runId)
      measured += 1
    } catch (error) {
      log(`[pilot] couldn't measure step ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
  return measured
}
