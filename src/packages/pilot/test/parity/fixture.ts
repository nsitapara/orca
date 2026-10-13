import { readFileSync } from 'node:fs'
import { EMPTY_PEOPLE } from '../../src/shared/people'
import { isAbsolute, join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { cachedQuotas } from '../../src/main/fields/quota'
import { runtimeFieldDeps } from '../../src/main/fields/runtime-field-deps'
import type { ScriptRunner } from '../../src/main/fields/script-runner'
import { listBusyTerminals } from '../../src/main/fields/worktree-busy'
import { registrySources } from '../../src/main/scheduler/tick-decide'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { createPassFetchCache, type PassFetchCache } from '../../src/main/sources/fetch-cache'
import type { GlabApi } from '../../src/main/sources/gitlab-api'
import type { IdsRunner } from '../../src/main/sources/ids-from'
import type { PilotStore } from '../../src/main/store/store'
import { fixtureBusyReads, fixtureQuota } from './fixture-activity'
import { fixtureRead, miss, orcaResult, stdoutOf, type ParityFixture } from './fixture-core'

// Quota and busy reads live in fixture-activity.ts; re-exported so importers of './fixture' are unchanged.
export { fixtureBusyReads, fixtureQuota }
// The read primitives live in fixture-core.ts, which fixture-activity.ts also builds on.
export {
  fixtureMisses,
  fixtureRead,
  NotInFixture,
  orcaResult,
  stdoutOf,
  type FixtureRead,
  type ParityFixture
} from './fixture-core'

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
    throw miss(f, `GET ${wanted}`)
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

// A git read that failed or timed out when it was recorded fails here too, as git would.
function gitStdout(f: ParityFixture, argv: string[]): string {
  const read = fixtureRead(f, argv)
  if (read.timeout || (read.code ?? 0) !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${read.stderr ?? 'timed out'}`)
  }
  return stdoutOf(read)
}

// Pilot's `git status --porcelain=v1` lists what the old side's `git -C <path> status --porcelain` did.
export function fixtureGit(f: ParityFixture): GitRunner {
  return async (args, { cwd }) => {
    if (args[0] === 'status') {
      return { stdout: gitStdout(f, ['git', '-C', cwd, 'status', '--porcelain']) }
    }
    throw miss(f, `git ${args.join(' ')} in ${cwd}`)
  }
}

export function fixtureGitOperation(f: ParityFixture): (path: string) => Promise<string | null> {
  return async (path) => {
    for (const [marker, op] of OLD_MARKERS) {
      const out = gitStdout(f, ['git', '-C', path, 'rev-parse', '--git-path', marker]).trim()
      const full = isAbsolute(out) ? out : join(path, out)
      const exists = f.exists[full]
      if (exists === undefined) {
        throw miss(f, `exists ${full}`)
      }
      if (exists) {
        return op
      }
    }
    return null
  }
}

// TickDeps for a dry run on a fixture. Every outside read comes from the fixture; nothing launches, and
// a script never runs (a job whose checks or fields use scripts overrides `fields.runScript`, and one whose source
// takes its ids from a command passes `runIds`). Tasks 19c
// (`activity`) and 25 (`ask`) add a fixture-backed value here when they add the TickDeps member. A dry
// run takes `{ dryRun: true, pass: fixturePass(f) }`; one given no pass makes its own over `gitlab`, which is the
// fixture's too, so no parity tick ever reaches the real GitLab.
export function fixtureTickDeps(
  f: ParityFixture,
  store: PilotStore,
  o: { runScript?: ScriptRunner; runIds?: IdsRunner } = {}
): TickDeps {
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
      runScript: o.runScript ?? ((req) => Promise.reject(miss(f, `script ${req.command}`))),
      engineEnv: { binDir: '', dataDir: '/tmp/pilot-parity' },
      now
    },
    // where.ids_from never runs a real command here; a job whose YAML has one answers it (13: jobs/job-13.ts).
    runIds:
      o.runIds ??
      ((cmd) => Promise.reject(miss(f, `ids_from ${[cmd.program, ...cmd.args].join(' ')}`))),
    activity: {
      terminals: () => listBusyTerminals(fixtureRuntime(f)),
      reads: () => fixtureBusyReads(f),
      terminalAlive: async (handle) => connectedHandles(f).has(handle)
    },
    ask: { store, now, inbox: { store, now, definitions: () => [], people: () => EMPTY_PEOPLE } },
    launch: async () => {
      throw new Error('parity: a dry run never launches')
    }
  }
}
