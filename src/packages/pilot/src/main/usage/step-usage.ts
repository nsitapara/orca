import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentKind } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import type { MeasurableStep } from '../store/store-usage'
import { mergeBuckets, type UsageBucket, type UsageWindow } from './buckets'
import { findChildSessions } from './child-sessions'
import { claudeSubagentFiles, claudeUsage, findClaudeTranscript } from './claude'
import { codexHomes as sharedCodexHomes } from './codex-homes'
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
  const codexHomes = sharedCodexHomes(env.CODEX_HOME, home)
  return { claudeProjects: join(claudeDir, 'projects'), codexHomes }
}

// One way to find a session's transcript (usage, the answers' fork check, a per_worktree resume): the
// recorded path when it is there, else Claude's under CLAUDE_CONFIG_DIR's projects, or Codex's rollout by
// its day folder (the session's first day) in each Codex home.
export async function findSessionTranscript(
  agent: AgentKind,
  sessionId: string,
  hinted: string | null,
  startedAt: number,
  paths: UsagePaths
): Promise<string | null> {
  if (agent === 'claude') {
    return findClaudeTranscript(sessionId, hinted, paths.claudeProjects)
  }
  return findCodexRollout(sessionId, hinted, startedAt, paths.codexHomes)
}

// The step's own session: its transcript and subagents (Claude) or its rollout (Codex); null when it can't be found.
async function ownUsage(
  step: MeasurableStep,
  sessionId: string,
  startedAt: number,
  window: UsageWindow,
  paths: UsagePaths
): Promise<UsageBucket[] | null> {
  if (step.agent === 'claude') {
    const main = await findClaudeTranscript(sessionId, step.transcriptPath, paths.claudeProjects)
    return main ? claudeUsage([main, ...(await claudeSubagentFiles(main))], window) : null
  }
  if (step.agent === 'codex') {
    const rollout = await findCodexRollout(
      sessionId,
      step.transcriptPath,
      startedAt,
      paths.codexHomes
    )
    return rollout ? codexUsage(rollout, window) : null
  }
  return null
}

// `claimed`: every step's own session, so another step's session never counts as this one's child.
export function stepUsageReader(
  paths: UsagePaths,
  now: () => number,
  claimed: () => ReadonlySet<string> = () => new Set()
): StepUsageReader {
  return async (step) => {
    if (!step.sessionId || step.startedAt === null) {
      return NOT_FOUND
    }
    const window = { from: step.startedAt, to: step.finishedAt ?? now() }
    const own = await ownUsage(step, step.sessionId, step.startedAt, window, paths)
    if (!own) {
      return NOT_FOUND
    }
    const children = await findChildSessions(
      { cwd: step.worktreePath, sessionId: step.sessionId, window, claimed: claimed() },
      paths
    )
    const childBuckets = await Promise.all([
      claudeUsage(children.claude, window),
      ...children.codex.map((rollout) => codexUsage(rollout, window))
    ])
    return { buckets: mergeBuckets([own, ...childBuckets]), sessionFound: true }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Called after every poll. Each agent step that ended is read once, inside its own window, so a session a later
// step or answer run resumes is never counted twice. One step's failure never stops the others.
export const MEASURE_MAX_FAILURES = 3
// Consecutive failed reads per step, kept across polls.
const readFailures = new Map<string, number>()

export async function measureFinishedSteps(
  store: PilotStore,
  read: StepUsageReader,
  now: () => number,
  log: (message: string) => void,
  failures: Map<string, number> = readFailures
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
      failures.delete(`${step.runId}/${step.idx}`)
      measured += 1
    } catch (error) {
      log(`[pilot] couldn't measure step ${step.runId}/${step.idx}: ${messageOf(error)}`)
      const key = `${step.runId}/${step.idx}`
      const count = (failures.get(key) ?? 0) + 1
      failures.set(key, count)
      if (count >= MEASURE_MAX_FAILURES) {
        failures.delete(key)
        store.usage.markMeasured(step.runId, step.idx, now())
        log(`[pilot] gave up measuring step ${key} after ${count} failed reads`)
      }
    }
  }
  return measured
}
