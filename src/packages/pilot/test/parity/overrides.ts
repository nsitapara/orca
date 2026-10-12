import type { ScriptRequest, ScriptResult } from '../../src/main/fields/script-runner'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import type { Item } from '../../src/main/sources/types'
import type { PilotStore } from '../../src/main/store/store'
import type { FieldValue } from '../../src/shared/api-types'
import type { FixtureRead, ParityFixture } from './fixture'

// gate.IN_PROGRESS, in its order (the git-operation markers the fixture's worktree facts read).
const MARKERS = [
  'MERGE_HEAD',
  'rebase-merge',
  'rebase-apply',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'index.lock'
]
const REPO = {
  id: 'repo-parity',
  path: '/parity/main',
  name: 'web-platform',
  project: 'polygenx/web-platform',
  host: 'gitlab.com'
}

export type FixtureWorktree = {
  id: string
  path: string
  branch: string
  linkedLinearIssue?: string | null
}
export type FixtureOver = {
  worktrees?: FixtureWorktree[]
  porcelain?: Record<string, string> // worktree path -> `git status --porcelain` output (clean when absent)
  quota?: ParityFixture['quota']
  state?: Record<string, unknown> // "<loop>/<file>" -> sweep state
  reads?: FixtureRead[]
  exists?: Record<string, boolean> // absolute path -> exists; a git-operation marker file is `/parity/gitdirs<worktree path>/<MARKER>`
}

// A Task 13a-format fixture with the repo, no terminals, and the given worktrees with their git reads.
export function parityFixture(
  job: string,
  kase: string,
  now: number,
  over: FixtureOver = {}
): ParityFixture {
  const worktrees = over.worktrees ?? []
  const listed = worktrees.map((w) => ({
    id: w.id,
    repoId: REPO.id,
    path: w.path,
    branch: `refs/heads/${w.branch}`,
    isArchived: false,
    linkedLinearIssue: w.linkedLinearIssue ?? null
  }))
  const reads: FixtureRead[] = [
    {
      argv: ['orca', 'worktree', 'list', '--json'],
      code: 0,
      json: { ok: true, result: { worktrees: listed } }
    },
    {
      argv: ['orca', 'terminal', 'list', '--json'],
      code: 0,
      json: { ok: true, result: { terminals: [] } }
    },
    ...(over.reads ?? [])
  ]
  const exists: Record<string, boolean> = { ...over.exists }
  for (const w of worktrees) {
    exists[w.path] = true
    reads.push({
      argv: ['git', '-C', w.path, 'status', '--porcelain'],
      code: 0,
      stdout: over.porcelain?.[w.path] ?? '',
      stderr: ''
    })
    for (const marker of MARKERS) {
      const gitdir = `/parity/gitdirs${w.path}/${marker}`
      reads.push({
        argv: ['git', '-C', w.path, 'rev-parse', '--git-path', marker],
        code: 0,
        stdout: `${gitdir}\n`,
        stderr: ''
      })
      if (!(gitdir in exists)) {
        exists[gitdir] = false
      }
    }
  }
  return {
    job,
    case: kase,
    recordedAt: '',
    now,
    repo: REPO,
    quota: over.quota,
    reads,
    state: over.state ?? {},
    exists
  }
}

// The same dry-run deps with the source's listing replaced by `items`. The kind's real scope() (where clauses, match)
// and everything after it still run; the real listing is covered by the source's own tests and the live dry run.
export function withListing(deps: TickDeps, items: Item[]): TickDeps {
  return { ...deps, sources: { ...deps.sources, list: async () => ({ items, warnings: [] }) } }
}

type Reading = { weekly: number | null; session: number | null }

// The same dry-run deps with each agent's quota reading given, in place of the readings fixtureQuota serves from the case.
export function withQuotas(
  deps: TickDeps,
  readings: { claude: Reading; codex: Reading }
): TickDeps {
  const reader = (reading: Reading) => async () => reading
  return {
    ...deps,
    fields: {
      ...deps.fields,
      quotas: { claude: reader(readings.claude), codex: reader(readings.codex) }
    }
  }
}

// The same deps with `inbox.pending_answers` given per item key (0 when absent).
export function withPendingAnswers(deps: TickDeps, counts: Record<string, number>): TickDeps {
  return {
    ...deps,
    fields: {
      ...deps.fields,
      pendingAnswers: (_automationId: string, itemKey: string) => counts[itemKey] ?? 0
    }
  }
}

// The same deps without the terminal-activity pre-pass, so the items' own `worktree.busy` (gate.worktree_busy's reason, '' when idle) stands.
export function withoutActivity(deps: TickDeps): TickDeps {
  return { ...deps, activity: undefined }
}

// A running run of `automationId` in each worktree, as another run holding it (or this automation's own run) looks to the tick.
export function seedRunning(
  store: PilotStore,
  automationId: string,
  runs: { id: string; itemKey: string; path: string; label: string }[],
  startedAt: number
): void {
  for (const r of runs) {
    store.runs.create({
      id: r.id,
      automationId,
      tickId: null,
      itemKey: r.itemKey,
      itemLabel: r.label,
      worktreePath: r.path,
      startedAt,
      status: 'running'
    })
  }
}

export type FixtureMr = {
  iid: number
  state: 'opened' | 'merged' | 'closed'
  author: string
  approvedBy?: string[]
  stateError?: string
  approvalError?: string
}

// The `mr.*` fields and gate blocks Tasks 14b and 15c fill for a worktree whose branch has this MR (null: none), with gate.py's
// own reasons: owner_block, the finished block (`!N merged`, `MR state unknown: …`), and review_block, which also holds both.
export function mrFields(mr: FixtureMr | null, me = 'nish8'): Record<string, FieldValue> {
  if (!mr) {
    return {
      'mr.iid': null,
      'mr.state': null,
      'mr.author': null,
      'mr.approved_by': '',
      'mr.lookup_error': null,
      'mr.owner_block': '',
      'mr.finished_block': '',
      'mr.review_block': '',
      'mr.draft_block': ''
    }
  }
  const owner = mr.author === me ? '' : `!${mr.iid} is ${mr.author}'s MR`
  const finished = finishedBlockOf(mr)
  const approvers = mr.approvedBy ?? []
  return {
    'mr.iid': mr.iid,
    'mr.state': mr.state,
    'mr.author': mr.author,
    'mr.approved_by': approvers.join(','),
    'mr.lookup_error': mr.stateError ?? mr.approvalError ?? null,
    'mr.owner_block': owner,
    'mr.finished_block': finished,
    'mr.review_block': owner || finished || approvedBlockOf(mr, approvers),
    'mr.draft_block': ''
  }
}

function finishedBlockOf(mr: FixtureMr): string {
  if (mr.stateError) {
    return `MR state unknown: ${mr.stateError}`
  }
  return mr.state === 'opened' ? '' : `!${mr.iid} ${mr.state}`
}

function approvedBlockOf(mr: FixtureMr, approvers: string[]): string {
  if (approvers.length > 0) {
    return `!${mr.iid} approved by ${approvers.join(', ')}`
  }
  return mr.approvalError ? `MR approval unknown: ${mr.approvalError}` : ''
}

export const ok = (stdout = ''): ScriptResult => ({
  code: 0,
  stdout,
  stderr: '',
  timedOut: false
})
export const failed = (reason: string): ScriptResult => ({
  code: 1,
  stdout: '',
  stderr: `${reason}\n`,
  timedOut: false
})

// Answers the field scripts and script checks a test knows (by req.command and req.env.PILOT_ITEM_KEY); null runs the real one.
export type ScriptAnswer = (req: ScriptRequest) => ScriptResult | null
export function withScripts(deps: TickDeps, answer: ScriptAnswer): TickDeps {
  const real = deps.fields.runScript
  return { ...deps, fields: { ...deps.fields, runScript: async (req) => answer(req) ?? real(req) } }
}
