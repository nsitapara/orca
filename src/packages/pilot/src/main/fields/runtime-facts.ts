import { basename } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { RepoFacts } from '../sources/types'

// How far back a finished step's tab still counts as maybe open (session: none_open).
export const SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60_000

export function stripRefsHeads(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

// The repo as the automation names it: Orca's display name or the checkout's folder name.
export async function resolveRepoPath(
  runtime: OrcaRuntimeService,
  repo: string
): Promise<RepoFacts> {
  const match = runtime.listRepos().find((r) => r.displayName === repo || basename(r.path) === repo)
  if (!match) {
    throw new Error(
      `Repo "${repo}" isn't added to Pilot. Add it in the sidebar, or fix "repo:" in the automation file.`
    )
  }
  return { name: repo, id: match.id, path: match.path, base: match.worktreeBaseRef ?? null }
}

// True once the runtime lists every repo (by display name or folder name, as resolveRepoPath).
// The runtime may not list repos right after start: the scheduler's first pass waits for this.
export function reposListed(runtime: OrcaRuntimeService, repos: readonly string[]): boolean {
  let listed: ReturnType<OrcaRuntimeService['listRepos']>
  try {
    listed = runtime.listRepos()
  } catch {
    return false
  }
  return repos.every((repo) =>
    listed.some((r) => r.displayName === repo || basename(r.path) === repo)
  )
}
