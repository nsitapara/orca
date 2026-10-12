import { normalize } from 'node:path'

// Orca's terminal list and its worktree list are separate registries, so their paths are compared in
// one form (dot segments and doubled or trailing slashes removed), never as raw strings.
export function worktreePathKey(path: string): string {
  const normal = normalize(path)
  return normal.length > 1 ? normal.replace(/\/+$/, '') : normal
}

// The spellings a stored worktree path may have: as given, in the one form tick items are written in, and
// that form with a trailing slash. Runs and inbox cards keep the path as Orca reported it, so timeline
// queries match any of them.
export function worktreePathSpellings(path: string): string[] {
  const key = worktreePathKey(path)
  return [...new Set([path, key, key === '/' ? key : `${key}/`])]
}
