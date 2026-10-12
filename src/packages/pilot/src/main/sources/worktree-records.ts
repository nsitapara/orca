import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { stripRefsHeads } from '../fields/runtime-facts'
import type { RepoFacts } from './types'

export type WorktreeRecord = {
  id: string
  path: string
  branch: string
  head: string
  isArchived: boolean
  isMain: boolean
  linkedLinearIssue: string | null
}

// Orca's managed worktrees of one repo. A cut-short list throws: the tick fails rather than miss some.
export function runtimeWorktreeRecords(
  runtime: OrcaRuntimeService
): (repo: RepoFacts) => Promise<WorktreeRecord[]> {
  return async (repo) => {
    const result = await runtime.listManagedWorktrees(`id:${repo.id}`)
    if (result.truncated) {
      throw new Error(
        `Worktree list for ${repo.path} was cut short (${result.totalCount} worktrees)`
      )
    }
    return result.worktrees.map((w) => ({
      id: w.id,
      path: w.git.path,
      branch: stripRefsHeads(w.git.branch),
      head: w.git.head,
      isArchived: w.isArchived,
      isMain: w.git.isMainWorktree,
      linkedLinearIssue: w.linkedLinearIssue ?? null
    }))
  }
}

const SKIP_BRANCHES = new Set(['dev', 'main'])

// gate.worktrees: not the main checkout, not archived, still on disk, on a branch, and not dev, main
// or the loops' own agent-loop/* branches. (Teammates' branches are the `branch_owner` clause.)
export function eligibleWorktree(w: WorktreeRecord, exists: (path: string) => boolean): boolean {
  if (w.isArchived || w.isMain || w.branch === '') {
    return false
  }
  if (SKIP_BRANCHES.has(w.branch) || w.branch.startsWith('agent-loop/')) {
    return false
  }
  return exists(w.path)
}
