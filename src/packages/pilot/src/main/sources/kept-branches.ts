import { basename } from 'node:path'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { WHERE_SCHEMAS } from '../../shared/definition/where'
import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { TickTrigger } from '../../shared/api-types-handover'
import { heldFolderReason, holderOf } from '../envs/hold'
import type { Pilotcli } from '../envs/pilotcli'
import { worktreePathKey } from '../fields/agent-activity'
import type { PilotStore } from '../store/store'
import type { Item, ItemSource, RepoFacts } from './types'
import type { WorktreeRecord } from './worktree-records'

const DRY_RUN_TIMEOUT_MS = 60_000
// update-branch's skip for a merge with conflicts: job 15 resolves those, so they never wait.
const CONFLICT = /^conflicts in /

// A local branch under pilot/ and the commit it's at.
export type KeptRef = { branch: string; head: string }

// git for-each-ref's "<branch>\t<sha>" lines.
export function keptRefsOf(stdout: string): KeptRef[] {
  return stdout.split('\n').flatMap((line) => {
    const [branch, head] = line.trim().split('\t')
    return branch && head ? [{ branch, head }] : []
  })
}

export type KeptBranchDeps = {
  store: PilotStore
  listWorktrees: (repo: RepoFacts) => Promise<WorktreeRecord[]>
  pilotcli: Pilotcli
  // Every local branch under pilot/ in the repo at path, or null when git can't say.
  keptBranches(path: string): Promise<KeptRef[] | null>
  now(): number
}

// The automation a run belongs to, from its last valid file: its repo and name.
function originOf(store: PilotStore, run: RunRow): { repo: string; name: string } | null {
  const origin = store.definitions.lastValid(run.automationId)
  const parsed = origin ? parseAutomationYaml(origin.yaml, origin.file) : null
  return parsed?.ok ? { repo: parsed.definition.repo, name: parsed.definition.name } : null
}

// kept.wait: why the merge can't land in the home worktree now, from pilotcli's dry run; '' when it can, or when it
// would conflict (the job's agent resolves that in a throwaway).
async function waitOf(
  deps: KeptBranchDeps,
  run: RunRow,
  home: string,
  branch: string
): Promise<string> {
  const holder = holderOf(deps.store.runs, home, run.id)
  if (holder) {
    const name = originOf(deps.store, holder)?.name ?? holder.automationId
    return heldFolderReason(holder, () => name, home)
  }
  const reply = await deps.pilotcli({
    args: [
      'git',
      'update-branch',
      home,
      '--merge',
      'true',
      '--keep-local',
      'true',
      '--to',
      branch,
      '--dry-run',
      'true'
    ],
    timeoutMs: DRY_RUN_TIMEOUT_MS
  })
  if (reply.outcome === 'ok' || (reply.outcome === 'skip' && CONFLICT.test(reply.reason))) {
    return ''
  }
  return reply.reason || `pilotcli answered ${reply.outcome}`
}

// env delete kept a run's commits on a branch: each kept_branch job ticks at once with it, as a feed's next stage does.
export function triggerKeptJobs(
  definitions: readonly AutomationDefinition[],
  run: RunRow,
  trigger: (id: string, cause: TickTrigger) => void
): void {
  for (const def of definitions.filter((d) => d.items?.kind === 'kept_branch')) {
    trigger(def.id, {
      automationId: run.automationId,
      runId: run.id,
      stage: null,
      ids: [`kept:${run.id}`]
    })
  }
}

const LIVE_STATUSES: readonly string[] = ['running', 'asking']

// The run a pilot/ branch holds commits of: pilot/<run> as env delete names it, or a name that ends in the run's id,
// as a skill's own branch did (pilot/ui-qa-<run>).
function runOfBranch(store: PilotStore, branch: string): RunRow | null {
  const parts = branch.slice('pilot/'.length).split('-')
  for (let i = 0; i < parts.length; i += 1) {
    const run = store.runs.get(parts.slice(i).join('-'))
    if (run) {
      return run
    }
  }
  return null
}

// Git is the truth about what hasn't come home: a pilot/ branch is there until job 15's forget step deletes it once its
// commits are in my worktree. The store follows it, so every view shows the same: a branch no env delete reported is
// recorded as kept, and a kept branch now gone is recorded as gone.
function reconcile(deps: KeptBranchDeps, repo: string, refs: readonly KeptRef[]): void {
  const branches = new Set(refs.map((r) => r.branch))
  for (const run of deps.store.runs.envs.keptPending()) {
    if (run.env?.kept && !branches.has(run.env.kept) && originOf(deps.store, run)?.repo === repo) {
      deps.store.runs.envs.keptGone(run.id, deps.now())
    }
  }
  for (const { branch } of refs) {
    const run = runOfBranch(deps.store, branch)
    if (
      run?.env &&
      !LIVE_STATUSES.includes(run.status) &&
      (run.env.kept !== branch || run.env.keptGoneAt)
    ) {
      deps.store.runs.envs.keptFound(run.id, branch)
    }
  }
}

// One item per pilot/ branch in the repo, whatever made it: the commits a throwaway kept (env delete) that haven't
// reached the run's home worktree. Job 15 merges each home; the branch goes once it's in, and with it the item. A run
// still going is left to its own end.
export function keptBranchSource(deps: KeptBranchDeps): ItemSource {
  return {
    kind: 'kept_branch',
    whereSchema: WHERE_SCHEMAS.kept_branch,
    async list(ctx) {
      const refs = await deps.keptBranches(ctx.repo.path)
      if (!refs) {
        return { items: [], warnings: [`Couldn't list the pilot/ branches in ${ctx.repo.path}`] }
      }
      reconcile(deps, ctx.repo.name, refs)
      const worktrees = await deps.listWorktrees(ctx.repo)
      const live = new Set(
        worktrees.filter((w) => !w.isArchived).map((w) => worktreePathKey(w.path))
      )
      const items: Item[] = []
      for (const { branch, head } of refs) {
        const run = runOfBranch(deps.store, branch)
        if (run && LIVE_STATUSES.includes(run.status)) {
          continue
        }
        const runId = run?.id ?? branch.slice('pilot/'.length)
        const home = run?.homePath ?? null
        const wait = await waitFor(deps, run, home, branch, live)
        // A run of job 15 that ended done yet left the branch (an answered card, a changed job): once_per counts them,
        // so the item is due again until the branch is home.
        const tries = deps.store.activity
          .forItem(null, `kept:${runId}`)
          .filter((r) => r.status === 'done').length
        items.push({
          kind: 'kept_branch',
          key: `kept:${runId}`,
          label: `${branch} → ${home ? basename(home) : '?'}`,
          fields: {
            'kept.branch': branch,
            'kept.head': head,
            'kept.run': runId,
            'kept.job': run ? (originOf(deps.store, run)?.name ?? run.automationId) : '',
            'kept.wait': wait,
            'kept.tries': tries,
            'worktree.path': home ?? ''
          },
          worktreeHint: home ? { path: home } : null,
          sortKeys: { waitingSince: run?.env?.removedAt ?? run?.finishedAt ?? null, priority: null }
        })
      }
      return { items, warnings: [] }
    },
    scope: () => ({ ok: true })
  }
}

// kept.wait for one branch: why it can't merge home now, or '' when it can.
async function waitFor(
  deps: KeptBranchDeps,
  run: RunRow | null,
  home: string | null,
  branch: string,
  live: ReadonlySet<string>
): Promise<string> {
  if (!run || !home) {
    return `no Pilot run says which worktree ${branch} came from; merge or delete it by hand`
  }
  if (!live.has(worktreePathKey(home))) {
    return `its worktree ${home} is gone; merge or delete ${branch} by hand`
  }
  return waitOf(deps, run, home, branch)
}
