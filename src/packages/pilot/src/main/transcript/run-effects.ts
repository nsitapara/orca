import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RunRow, StepRow } from '../../shared/api-types'
import type { Effect, RunEffects } from '../../shared/visibility-types'
import type { PilotStore } from '../store/store'
import { findClaudeTranscript } from '../usage/claude'
import { inWindow } from './claude-log'
import { gitlabBaseOf, linearBaseOf, linkEffects, webBase } from './effect-links'
import { actionEffects, stepEffects } from './effects'
import type { LogReader } from './log-file'

const exec = promisify(execFile)
const MAX_CACHED_STEPS = 2000

export type RemoteOf = (path: string) => Promise<string | null>
export type RunEffectsDeps = {
  store: PilotStore
  reader: LogReader
  claudeProjects: string
  remoteOf?: RemoteOf
}

// `git remote get-url origin` in a worktree; null when the worktree is gone or has no origin.
export async function originRemote(path: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      timeout: 5000
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function fieldUrls(store: PilotStore, row: RunRow): string[] {
  if (row.tickId === null) {
    return []
  }
  const fields = store.tickItems(row.tickId).find((i) => i.runId === row.id)?.fields ?? {}
  return Object.values(fields).filter(
    (v): v is string => typeof v === 'string' && /^https?:\/\//.test(v)
  )
}

// A run's effects (spec §2): its catalog actions and each Claude step's transcript inside the step's window, with
// links. An ended step's effects can't change, so they are kept after the first read.
export class RunEffectsReader {
  private readonly ended = new Map<string, Effect[]>()
  private readonly remotes = new Map<string, string | null>()

  constructor(private readonly deps: RunEffectsDeps) {}

  async forRuns(runIds: readonly string[]): Promise<RunEffects> {
    const pairs = await Promise.all(runIds.map(async (id) => [id, await this.forRun(id)] as const))
    return Object.fromEntries(pairs)
  }

  async forRun(runId: string): Promise<Effect[]> {
    const { store } = this.deps
    const row = store.runs.get(runId)
    if (!row) {
      return []
    }
    const claude = store.runs.steps(runId).filter((s) => s.agent === 'claude')
    const fromSteps = await Promise.all(claude.map((s) => this.stepOf(row, s)))
    const all = [...actionEffects(store.actions.forRun(runId)), ...fromSteps.flat()]
    const urls = [
      ...all.map((e) => e.url).filter((u): u is string => u !== null),
      ...fieldUrls(store, row)
    ]
    const linear = linearBaseOf(urls) ?? linearBaseOf(store.visibility.recentLinearUrls())
    return linkEffects(all, { gitlab: await this.gitlabBase(row, urls), linear })
  }

  private async stepOf(row: RunRow, step: StepRow): Promise<Effect[]> {
    const key = `${row.id}:${step.idx}`
    const kept = this.ended.get(key)
    if (kept) {
      return kept
    }
    const path = step.sessionId
      ? await findClaudeTranscript(step.sessionId, step.transcriptPath, this.deps.claudeProjects)
      : null
    if (!path) {
      return []
    }
    let effects: Effect[]
    try {
      const state = await this.deps.reader.read(path)
      effects = stepEffects(
        inWindow(state.entries, step.startedAt ?? row.startedAt, step.finishedAt).inside,
        step.idx
      )
    } catch {
      return []
    }
    if (step.finishedAt !== null) {
      this.keep(key, effects)
    }
    return effects
  }

  private keep(key: string, effects: Effect[]): void {
    this.ended.set(key, effects)
    if (this.ended.size > MAX_CACHED_STEPS) {
      this.ended.delete(this.ended.keys().next().value as string)
    }
  }

  private async remoteBase(path: string): Promise<string | null> {
    if (!this.remotes.has(path)) {
      this.remotes.set(path, await (this.deps.remoteOf ?? originRemote)(path))
    }
    const remote = this.remotes.get(path)
    return remote ? webBase(remote) : null
  }

  // The GitLab project: the run's worktree's origin, else one of the run's own GitLab URLs.
  private async gitlabBase(row: RunRow, urls: readonly string[]): Promise<string | null> {
    for (const path of [row.worktreePath, row.homePath]) {
      const base = path ? await this.remoteBase(path) : null
      if (base) {
        return base
      }
    }
    return gitlabBaseOf(urls)
  }
}
