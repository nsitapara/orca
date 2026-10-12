import { normalize } from 'node:path'

// Orca's terminal list and its worktree list are separate registries, so their paths are compared in
// one form (dot segments and doubled or trailing slashes removed), never as raw strings.
export function worktreePathKey(path: string): string {
  const normal = normalize(path)
  return normal.length > 1 ? normal.replace(/\/+$/, '') : normal
}
