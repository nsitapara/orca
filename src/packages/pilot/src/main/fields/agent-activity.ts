import { worktreePathKey } from '../../shared/worktree-path-key'

export { worktreePathKey }

// The spellings a stored worktree path may have: as given, in the one form tick items are written in, and
// that form with a trailing slash. Runs and inbox cards keep the path as Orca reported it, so timeline
// queries match any of them.
export function worktreePathSpellings(path: string): string[] {
  const key = worktreePathKey(path)
  return [...new Set([path, key, key === '/' ? key : `${key}/`])]
}
