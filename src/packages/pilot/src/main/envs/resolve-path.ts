import { STOPPED } from './prepare'

export const RESOLVE_TIMEOUT_MS = 60_000
const POLL_MS = 1000

// The two runtime calls this needs (OrcaRuntimeService has both, public).
export type WorktreeRuntime = {
  invalidateWorktreeCatalog(repoId: string): void
  showManagedWorktree(selector: string): Promise<{ id: string; git: { path: string } }>
}
type Clock = { now(): number; sleep(ms: number): Promise<void>; timeoutMs: number }
const REAL: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: RESOLVE_TIMEOUT_MS
}

// pilotcli's `git worktree add` happens outside Pilot, so Pilot's own runtime rescans the repo's worktrees and polls the
// path:<path> selector until it resolves (M4 §8: Pilot resolves the folder in its own runtime, not with --wait-orca).
export async function resolveEnvPath(
  runtime: WorktreeRuntime,
  repoId: string,
  path: string,
  signal: AbortSignal,
  clock: Clock = REAL
): Promise<{ id: string; path: string }> {
  const deadline = clock.now() + clock.timeoutMs
  for (;;) {
    runtime.invalidateWorktreeCatalog(repoId)
    try {
      const found = await runtime.showManagedWorktree(`path:${path}`)
      return { id: found.id, path: found.git.path }
    } catch {
      // not listed yet
    }
    if (signal.aborted) {
      throw new Error(STOPPED)
    }
    if (clock.now() >= deadline) {
      throw new Error(
        `Pilot's runtime didn't list ${path} within ${Math.round(clock.timeoutMs / 1000)}s`
      )
    }
    await clock.sleep(POLL_MS)
  }
}
