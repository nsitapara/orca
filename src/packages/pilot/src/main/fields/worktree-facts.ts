import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ItemFields } from '../../shared/api-types'
import type { Item } from '../sources/types'
import type { AgentState } from '../run/agent-rows'
import { stripRefsHeads } from './runtime-facts'

export type WorktreeInfo = {
  id: string
  path: string
  branch: string
  head: string | null
  linkedLinearIssue: string | null
}
// One step in a worktree: still starting/running (active), or finished with the terminal it ran
// in, whose tab may still be open.
export type SessionStep = { active: boolean; handle: string | null; paneKey: string | null }
export type GitStatusCounts = { dirty: number; untracked: number }
export type WorktreeFactDeps = {
  // Read by the run launcher (Task 8), not by the facts.
  paneState(paneKey: string): AgentState
  terminalDraft(handle: string): Promise<string>
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  gitStatus(path: string): Promise<GitStatusCounts>
  gitOperation(path: string): Promise<string | null>
  automationSessions(automationId: string, worktreePath: string): SessionStep[]
  anySessions(worktreePath: string): SessionStep[]
  terminalAlive(handle: string, paneKey: string | null): Promise<boolean>
}

const OPERATION_MARKERS: [string, string][] = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['sequencer', 'cherry-pick or revert'],
  ['BISECT_LOG', 'bisect'],
  ['index.lock', 'git operation (index.lock)']
]

export function detectGitOperation(gitDir: string): string | null {
  // rebase-apply also holds a `git am` in progress, marked by an `applying` file.
  if (existsSync(join(gitDir, 'rebase-apply', 'applying'))) {
    return 'am'
  }
  for (const [marker, name] of OPERATION_MARKERS) {
    if (existsSync(join(gitDir, marker))) {
      return name
    }
  }
  return null
}

// The item has no worktree: a known absence, so no session is open there.
export const NO_WORKTREE: ItemFields = {
  'worktree.path': null,
  'worktree.id': null,
  'worktree.branch': null,
  'worktree.head': null,
  'worktree.dirty_count': null,
  'worktree.untracked_count': null,
  'worktree.git_operation': null,
  'session.open_from_automation': false,
  'session.open_any': false
}

// Spec §3: by id, path, branch, then the worktree linked to the item's Linear issue. A run-once
// item's worktree is the repo's main checkout.
export function worktreeFor(
  item: Item,
  list: readonly WorktreeInfo[],
  repoPath: string
): WorktreeInfo | null {
  if (item.kind === 'repo') {
    return list.find((w) => w.path === repoPath) ?? null
  }
  const hint = item.worktreeHint
  if (!hint) {
    return null
  }
  const byId = hint.id ? list.find((w) => w.id === hint.id) : undefined
  const byPath = hint.path ? list.find((w) => w.path === hint.path) : undefined
  const branch = hint.branch ? stripRefsHeads(hint.branch) : null
  const byBranch = branch ? list.find((w) => w.branch === branch) : undefined
  const issue = hint.linearIssue?.toUpperCase()
  const byIssue = issue ? list.find((w) => w.linkedLinearIssue?.toUpperCase() === issue) : undefined
  return byId ?? byPath ?? byBranch ?? byIssue ?? null
}

type Read<T> = { ok: true; value: T } | { ok: false }

async function attempt<T>(read: () => T | Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() }
  } catch {
    return { ok: false }
  }
}

// Open while a step still starts or runs, and after it finishes while its tab is still open (M1).
async function sessionOpen(steps: SessionStep[], deps: WorktreeFactDeps): Promise<boolean> {
  if (steps.some((s) => s.active)) {
    return true
  }
  const reads = await Promise.allSettled(
    steps.flatMap((s) => (s.handle ? [deps.terminalAlive(s.handle, s.paneKey)] : []))
  )
  if (reads.some((r) => r.status === 'fulfilled' && r.value)) {
    return true
  }
  const failed = reads.find((r) => r.status === 'rejected')
  if (failed) {
    throw failed.reason
  }
  return false
}

function countOrNull(status: Read<GitStatusCounts>, key: keyof GitStatusCounts): number | null {
  if (!status.ok) {
    return null
  }
  return status.value[key]
}

// A fact that couldn't be read stays unknown (null, or absent for the operation and sessions), so
// the checks fail on it. It is never defaulted to a passing value.
export async function worktreeFacts(
  wt: WorktreeInfo,
  automationId: string,
  deps: WorktreeFactDeps
): Promise<ItemFields> {
  const [status, op, mine, any] = await Promise.all([
    attempt(() => deps.gitStatus(wt.path)),
    attempt(() => deps.gitOperation(wt.path)),
    attempt(() => sessionOpen(deps.automationSessions(automationId, wt.path), deps)),
    attempt(() => sessionOpen(deps.anySessions(wt.path), deps))
  ])
  const fields: ItemFields = {
    'worktree.path': wt.path,
    'worktree.id': wt.id,
    'worktree.branch': wt.branch,
    'worktree.head': wt.head,
    'worktree.dirty_count': countOrNull(status, 'dirty'),
    'worktree.untracked_count': countOrNull(status, 'untracked')
  }
  if (op.ok) {
    fields['worktree.git_operation'] = op.value
  }
  if (mine.ok) {
    fields['session.open_from_automation'] = mine.value
  }
  if (any.ok) {
    fields['session.open_any'] = any.value
  }
  return fields
}
