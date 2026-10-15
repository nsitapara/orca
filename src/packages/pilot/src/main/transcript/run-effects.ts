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
import { mapLimit } from '../map-limit'

const exec = promisify(execFile)
const MAX_CACHED = 2000
const RUNS_AT_ONCE = 8
export const REMOTE_MISS_MS = 60_000
const LIVE = new Set(['asking', 'running'])

export type RemoteOf = (path: string) => Promise<string | null>
export type RecentUrls = () => readonly string[]
export type RunEffectsDeps = {
  store: PilotStore
  reader: LogReader
  claudeProjects: string
  remoteOf?: RemoteOf
  now?: () => number
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

// The recent Linear URLs, read from the store at most once per call and only if some run needs them.
export function lazyRecentUrls(store: PilotStore): RecentUrls {
  let recent: readonly string[] | null = null
  return () => {
    recent ??= store.visibility.recentLinearUrls()
    return recent
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

// Keeps a map to its newest `MAX_CACHED` keys; a read moves its key to the end.
function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_CACHED) {
    map.delete(map.keys().next().value as string)
  }
}

// A run's effects (spec §2): its catalog actions and each Claude step's transcript inside the step's window, with
// links. An ended step's effects can't change, nor can an ended run's until it gains a done action.
export class RunEffectsReader {
  private readonly ended = new Map<string, Effect[]>()
  private readonly runs = new Map<string, Effect[]>()
  private readonly remotes = new Map<string, string>()
  private readonly misses = new Map<string, number>()
  private readonly asking = new Map<string, Promise<string | null>>()

  constructor(private readonly deps: RunEffectsDeps) {}

  async forRuns(runIds: readonly string[]): Promise<RunEffects> {
    const recent = lazyRecentUrls(this.deps.store)
    const ids = [...new Set(runIds)]
    const pairs = await mapLimit(
      ids,
      RUNS_AT_ONCE,
      async (id) => [id, await this.forRun(id, recent)] as const
    )
    return Object.fromEntries(pairs)
  }

  async forRun(
    runId: string,
    recent: RecentUrls = lazyRecentUrls(this.deps.store)
  ): Promise<Effect[]> {
    const { store } = this.deps
    const row = store.runs.get(runId)
    if (!row) {
      return []
    }
    const actions = actionEffects(store.actions.forRun(runId))
    const claude = store.runs.steps(runId).filter((s) => s.agent === 'claude')
    // An action that finishes later (a card's push) changes the key, so the run is read again.
    const key = `${runId}:${actions.length}`
    const settled = !LIVE.has(row.status) && claude.every((s) => s.finishedAt !== null)
    const kept = settled ? this.runs.get(key) : undefined
    if (kept) {
      remember(this.runs, key, kept)
      return kept
    }
    const fromSteps = await Promise.all(claude.map((s) => this.stepOf(row, s)))
    const linked = await this.linked(
      row,
      [...actions, ...fromSteps.flatMap((list) => list ?? [])],
      recent
    )
    if (settled && fromSteps.every((list) => list !== null)) {
      remember(this.runs, key, linked)
    }
    return linked
  }

  // The effects with their links; a run with none asks neither git nor the store.
  private async linked(row: RunRow, all: Effect[], recent: RecentUrls): Promise<Effect[]> {
    if (all.length === 0) {
      return []
    }
    const urls = [
      ...all.map((e) => e.url).filter((u): u is string => u !== null),
      ...fieldUrls(this.deps.store, row)
    ]
    const linear = linearBaseOf(urls) ?? linearBaseOf(recent())
    return linkEffects(all, { gitlab: await this.gitlabBase(row, urls), linear })
  }

  // A step's effects; null when its transcript couldn't be read this time.
  private async stepOf(row: RunRow, step: StepRow): Promise<Effect[] | null> {
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
      return null
    }
    if (step.finishedAt !== null) {
      remember(this.ended, key, effects)
    }
    return effects
  }

  // A found remote is kept; a miss is remembered for a minute, and callers asking at once share one git call.
  private async remoteBase(path: string): Promise<string | null> {
    let remote = this.remotes.get(path) ?? null
    const now = (this.deps.now ?? Date.now)()
    const missed = this.misses.get(path)
    if (remote === null && missed !== undefined && now - missed < REMOTE_MISS_MS) {
      return null
    }
    if (remote === null) {
      let pending = this.asking.get(path)
      if (!pending) {
        pending = (this.deps.remoteOf ?? originRemote)(path).finally(() => this.asking.delete(path))
        this.asking.set(path, pending)
      }
      remote = await pending
      if (remote) {
        this.remotes.set(path, remote)
        this.misses.delete(path)
      } else {
        this.misses.set(path, now)
      }
    }
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
