export type EnvMode = 'in_place' | 'throwaway' | 'kept'
// preparing: env create is running. ready: the steps work in it. deferred: not_yet, nothing ran. failed: create failed,
// was refused or was stopped. removed: env delete answered ok, or nothing was ever made. stuck: env delete refused the
// run (invalid); shown, never retried.
export type EnvState = 'preparing' | 'ready' | 'deferred' | 'failed' | 'removed' | 'stuck'
export type RunEnvStack = {
  kind: 'backend' | 'full'
  project: string
  urls: Record<string, string>
  log: string | null
}
export type RunEnv = {
  state: EnvState
  mode: EnvMode | null
  reason: string | null
  path: string | null
  sha: string | null
  envFile: string | null
  vars: Record<string, string>
  stack: RunEnvStack | null
  removedAt: number | null
  deleteError: string | null
  deleteAttempts: number
  // The branch env delete kept a throwaway's unhomed commits on; absent when it kept none, or from older pilotcli.
  kept?: string
  // When that branch was found gone from git: merged home by job 15, or deleted. Absent while it waits.
  keptGoneAt?: number
  // A throwaway env delete couldn't remove that still holds work nothing else has; absent once it's removed or holds none.
  stranded?: RunStranded
}

// What a throwaway that couldn't be removed still holds that nothing else has (main/envs/stranded.ts): its commits on no
// origin branch, no pilot/ branch and not in its home's HEAD, newest first, and how many files it has uncommitted (ignored
// ones never). cardId: the flagged card that says so (main/envs/stranded-card.ts), null when it couldn't be written.
export type StrandedWork = { commits: string[]; edits: number }
export type RunStranded = StrandedWork & { cardId: string | null }

// Where a run's work belongs (cards, answers, the timeline, the worktree panel): its item's worktree. For an env run it may
// differ from the folder it worked in (worktreePath).
export function homeOf(run: {
  homePath?: string | null
  worktreePath: string | null
}): string | null {
  return run.homePath ?? run.worktreePath
}

// A throwaway's folder goes when its run ends (M4 §8, Ruling P11): an ended throwaway run's sessions can't be reopened. A
// running one still works in its folder. Resume (main/run/resume-session.ts) and the run card both read this.
export function checkoutRemoved(run: { status: string; env?: RunEnv | null }): boolean {
  if (run.env?.mode !== 'throwaway') {
    return false
  }
  return run.env.removedAt !== null || (run.status !== 'running' && run.status !== 'asking')
}
