import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { normalizeArtifactPath } from './artifacts-match'
import { isThisMachinesWorktree } from './artifacts-feed'

/** This machine's worktree and folder paths Orca knows, to the project each belongs to. */
export function useKnownRepoPaths(): ReadonlyMap<string, string> {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  return useMemo(() => {
    const names = new Map(repos.map((repo) => [repo.id, repo.displayName]))
    const known = new Map<string, string>()
    for (const [repoId, worktrees] of Object.entries(worktreesByRepo)) {
      const name = names.get(repoId)
      for (const worktree of name ? worktrees : []) {
        if (name && isThisMachinesWorktree(worktree)) {
          known.set(normalizeArtifactPath(worktree.path), name)
        }
      }
    }
    return known
  }, [repos, worktreesByRepo])
}
