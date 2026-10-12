import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { cachedQuotas, type QuotaReading } from '../../src/main/fields/quota'
import { runtimeFieldDeps } from '../../src/main/fields/runtime-field-deps'
import { registrySources } from '../../src/main/scheduler/tick-decide'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { createPassFetchCache, type PassFetchCache } from '../../src/main/sources/fetch-cache'
import type { GlabApi } from '../../src/main/sources/gitlab-api'
import type { PilotStore } from '../../src/main/store/store'
import type { AgentKind } from '../../src/shared/definition/types'

export type FixtureRead = {
  argv: string[]
  code?: number | null
  stdout?: string
  json?: unknown
  stderr?: string
  timeout?: boolean
}
export type ParityFixture = {
  job: string
  case: string
  recordedAt: string
  now: number
  repo: { id: string; path: string; name: string; project: string; host: string }
  quota?: Partial<Record<AgentKind, QuotaReading>>
  reads: FixtureRead[]
  state: Record<string, unknown>
  exists: Record<string, boolean>
}

export class NotInFixture extends Error {
  constructor(what: string) {
    super(
      `Not in the fixture: ${what}. Re-record the case, or add the read to the job adapter's record_extras.`
    )
    this.name = 'NotInFixture'
  }
}

// gate.IN_PROGRESS, in its order, and the name Pilot's facts give each (worktree-fields.ts).
const OLD_MARKERS: [string, string][] = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
  ['index.lock', 'git operation (index.lock)']
]

type ListedWorktree = {
  id: string
  repoId: string
  path: string
  branch?: string
  isArchived?: boolean
  linkedLinearIssue?: string | null
}
type ListedTerminal = { handle: string; connected?: boolean }
type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>

export function loadFixture(path: string): ParityFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as ParityFixture
}

export function stdoutOf(read: FixtureRead): string {
  if (read.stdout !== undefined) {
    return read.stdout
  }
  if (read.json !== undefined) {
    return JSON.stringify(read.json)
  }
  return ''
}

// The old side appends &page=1 and puts params in its own order; Pilot doesn't. Same request either way.
export function normalizeApiPath(path: string): string {
  const at = path.indexOf('?')
  if (at === -1) {
    return path
  }
  const params = new URLSearchParams(path.slice(at + 1))
  if (params.get('page') === '1') {
    params.delete('page')
  }
  const query = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return query ? `${path.slice(0, at)}?${query}` : path.slice(0, at)
}

export function fixtureRead(f: ParityFixture, argv: string[]): FixtureRead {
  const found = f.reads.find(
    (r) => r.argv.length === argv.length && r.argv.every((a, i) => a === argv[i])
  )
  if (!found) {
    throw new NotInFixture(argv.join(' '))
  }
  return found
}

function orcaResult<T>(f: ParityFixture, args: string[]): T {
  return (JSON.parse(stdoutOf(fixtureRead(f, ['orca', ...args, '--json']))) as { result: T }).result
}

export function connectedHandles(f: ParityFixture): Set<string> {
  const terminals = orcaResult<{ terminals: ListedTerminal[] }>(f, ['terminal', 'list']).terminals
  return new Set(terminals.filter((t) => t.connected).map((t) => t.handle))
}

function glabRead(f: ParityFixture, wanted: string): unknown {
  const read = f.reads.find(
    (r) =>
      r.argv[0] === 'glab' &&
      r.argv[1] === 'api' &&
      normalizeApiPath(r.argv.at(-1) ?? '') === wanted
  )
  if (!read) {
    throw new NotInFixture(`GET ${wanted}`)
  }
  if ((read.code ?? 0) !== 0) {
    throw new Error(`glab api ${wanted} failed: ${read.stderr ?? ''}`)
  }
  return JSON.parse(stdoutOf(read))
}

// get: inside the repo's project (Pilot's paths are relative to it). getRoot: outside it (`user`).
export function fixtureGlab(f: ParityFixture): GlabApi & { getRoot<T>(path: string): Promise<T> } {
  const prefix = `projects/${encodeURIComponent(f.repo.project)}/`
  return {
    projectPath: f.repo.project,
    async get<T>(path: string): Promise<T> {
      return glabRead(f, normalizeApiPath(`${prefix}${path}`)) as T
    },
    async getRoot<T>(path: string): Promise<T> {
      return glabRead(f, normalizeApiPath(path)) as T
    }
  }
}

// The per-pass client cache a real tick gets from the scheduler, over the fixture's GitLab.
export function fixturePass(f: ParityFixture, passId = 'parity'): PassFetchCache {
  return createPassFetchCache(passId, async () => fixtureGlab(f))
}

// Just what runtime-facts and the terminal relister call, answered from the old side's orca reads.
export function fixtureRuntime(f: ParityFixture): OrcaRuntimeService {
  const fake = {
    listRepos: () => [{ id: f.repo.id, path: f.repo.path, displayName: f.repo.name }],
    async listManagedWorktrees() {
      const all = orcaResult<{ worktrees: ListedWorktree[] }>(f, ['worktree', 'list']).worktrees
      const worktrees = all
        .filter((w) => w.repoId === f.repo.id && !w.isArchived)
        .map((w) => ({
          id: w.id,
          git: { path: w.path, branch: w.branch ?? '' },
          linkedLinearIssue: w.linkedLinearIssue ?? null
        }))
      return { worktrees, truncated: false, totalCount: worktrees.length }
    },
    async showTerminal(handle: string) {
      if (!connectedHandles(f).has(handle)) {
        throw new Error('terminal_not_found')
      }
      return {}
    },
    async listTerminals() {
      const terminals = orcaResult<{ terminals: ListedTerminal[] }>(f, [
        'terminal',
        'list'
      ]).terminals
      return { terminals, truncated: false, totalCount: terminals.length }
    }
  }
  return fake as unknown as OrcaRuntimeService
}

// Pilot's `git status --porcelain=v1` lists what the old side's `git -C <path> status --porcelain` did.
export function fixtureGit(f: ParityFixture): GitRunner {
  return async (args, { cwd }) => {
    if (args[0] === 'status') {
      return { stdout: stdoutOf(fixtureRead(f, ['git', '-C', cwd, 'status', '--porcelain'])) }
    }
    throw new NotInFixture(`git ${args.join(' ')} in ${cwd}`)
  }
}

export function fixtureGitOperation(f: ParityFixture): (path: string) => Promise<string | null> {
  return async (path) => {
    for (const [marker, op] of OLD_MARKERS) {
      const out = stdoutOf(
        fixtureRead(f, ['git', '-C', path, 'rev-parse', '--git-path', marker])
      ).trim()
      const full = isAbsolute(out) ? out : join(path, out)
      const exists = f.exists[full]
      if (exists === undefined) {
        throw new NotInFixture(`exists ${full}`)
      }
      if (exists) {
        return op
      }
    }
    return null
  }
}

const UNKNOWN_QUOTA: QuotaReading = { weekly: null, session: null }

// The quota the old sweep read (quota.py), as the case saved it: Claude's `{ weekly, session }` percentages in
// state `quota/claude.json`, else the case's `quota` field. A case without one has an unknown quota, which lets a
// job run. Codex reads unknown until Task 37 adds its raw-answer branch.
export function fixtureQuota(f: ParityFixture, agent: AgentKind): QuotaReading {
  if (agent === 'codex') {
    return f.quota?.codex ?? UNKNOWN_QUOTA
  }
  const saved = (f.state['quota/claude.json'] ?? f.quota?.claude) as
    | Partial<QuotaReading>
    | null
    | undefined
  return { weekly: saved?.weekly ?? null, session: saved?.session ?? null }
}

// TickDeps for a dry run on a fixture. Every outside read comes from the fixture; nothing launches, and
// a script never runs (a job whose checks or fields use scripts overrides `fields.runScript`). Tasks 19c
// (`activity`) and 25 (`ask`) add a fixture-backed value here when they add the TickDeps member. A dry
// run takes `{ dryRun: true, pass: fixturePass(f) }`; one given no pass makes its own over `gitlab`, which is the
// fixture's too, so no parity tick ever reaches the real GitLab.
export function fixtureTickDeps(f: ParityFixture, store: PilotStore): TickDeps {
  const now = () => f.now
  return {
    store,
    now,
    resolveRepo: async () => ({ id: f.repo.id, name: f.repo.name, path: f.repo.path, base: null }),
    sources: registrySources,
    gitlab: async () => fixtureGlab(f),
    fields: {
      ...runtimeFieldDeps(fixtureRuntime(f), store, {
        git: fixtureGit(f),
        relist: async (handle) => connectedHandles(f).has(handle),
        now
      }),
      gitOperation: fixtureGitOperation(f),
      quotas: cachedQuotas({
        claude: async () => fixtureQuota(f, 'claude'),
        codex: async () => fixtureQuota(f, 'codex')
      }),
      pendingAnswers: (automationId, itemKey) =>
        store.queue.pendingAnswerCount(automationId, itemKey),
      cache: store.fields,
      runScript: async (req) => {
        throw new NotInFixture(`script ${req.command}`)
      },
      engineEnv: { binDir: '', dataDir: '/tmp/pilot-parity' },
      now
    },
    launch: async () => {
      throw new Error('parity: a dry run never launches')
    }
  }
}
