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

export type KeptBranchDeps = {
  store: PilotStore
  listWorktrees: (repo: RepoFacts) => Promise<WorktreeRecord[]>
  pilotcli: Pilotcli
  // The tip of a local branch in the repo at path, or null when there's no such branch.
  branchTip(path: string, branch: string): Promise<string | null>
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

// The commits a throwaway kept on pilot/<run> (env delete) that haven't reached the run's home worktree: one item per
// run whose branch still exists. Job 15 merges each home; the branch goes once it's in, and with it the item.
export function keptBranchSource(deps: KeptBranchDeps): ItemSource {
  return {
    kind: 'kept_branch',
    whereSchema: WHERE_SCHEMAS.kept_branch,
    async list(ctx) {
      const worktrees = await deps.listWorktrees(ctx.repo)
      const live = new Set(
        worktrees.filter((w) => !w.isArchived).map((w) => worktreePathKey(w.path))
      )
      const items: Item[] = []
      for (const run of deps.store.runs.envs.keptPending()) {
        const branch = run.env?.kept
        const home = run.homePath
        if (!branch || !home || originOf(deps.store, run)?.repo !== ctx.repo.name) {
          continue
        }
        const head = await deps.branchTip(ctx.repo.path, branch)
        if (!head) {
          continue
        }
        const wait = live.has(worktreePathKey(home))
          ? await waitOf(deps, run, home, branch)
          : `its worktree ${home} is gone; merge or delete ${branch} by hand`
        items.push({
          kind: 'kept_branch',
          key: `kept:${run.id}`,
          label: `${branch} → ${basename(home)}`,
          fields: {
            'kept.branch': branch,
            'kept.head': head,
            'kept.run': run.id,
            'kept.job': originOf(deps.store, run)?.name ?? run.automationId,
            'kept.wait': wait,
            'worktree.path': home
          },
          worktreeHint: { path: home },
          sortKeys: { waitingSince: run.env?.removedAt ?? null, priority: null }
        })
      }
      return { items, warnings: [] }
    },
    scope: () => ({ ok: true })
  }
}
