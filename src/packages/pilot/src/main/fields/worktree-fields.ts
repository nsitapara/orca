import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FieldValue, ItemFields, TickItem } from '../../shared/api-types'

export type WorktreeInfo = { id: string; path: string; branch: string }
// One of this automation's steps in a worktree: still starting/running (active), or finished with the
// terminal it ran in, whose tab may still be open.
export type SessionStep = { active: boolean; handle: string | null; paneKey: string | null }
export type FactDeps = {
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  gitStatusCount(path: string): Promise<number>
  gitOperation(path: string): Promise<string | null>
  automationSessions(automationId: string, worktreePath: string): SessionStep[]
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

// The branch has no worktree: a known absence, so there are no sessions in it either.
const NO_WORKTREE: ItemFields = {
  'worktree.path': null,
  'worktree.id': null,
  'worktree.dirty_count': null,
  'worktree.git_operation': null,
  'session.open_from_automation': false
}

type Read<T> = { ok: true; value: T } | { ok: false }

async function attempt<T>(read: () => T | Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() }
  } catch {
    return { ok: false }
  }
}

// Open while a step still starts or runs, and after it finishes while its tab is still open: the old
// 05 waited for its CI-fix tab to close, and an agent's Stop hook marks the step done well before that.
async function sessionOpen(deps: FactDeps, automationId: string, path: string): Promise<boolean> {
  const steps = deps.automationSessions(automationId, path)
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

// A fact that could not be read is left unknown (null for the count, absent otherwise) so Task 14's
// checks fail on it. It is never defaulted to a passing value.
function setIfRead(
  fields: ItemFields,
  key: string,
  read: Read<FieldValue>,
  unknown?: FieldValue
): void {
  if (read.ok) {
    fields[key] = read.value
  } else if (unknown !== undefined) {
    fields[key] = unknown
  }
}

async function worktreeFacts(
  wt: WorktreeInfo,
  automationId: string,
  deps: FactDeps
): Promise<ItemFields> {
  const [dirty, op, open] = await Promise.all([
    attempt(() => deps.gitStatusCount(wt.path)),
    attempt(() => deps.gitOperation(wt.path)),
    attempt(() => sessionOpen(deps, automationId, wt.path))
  ])
  const fields: ItemFields = { 'worktree.path': wt.path, 'worktree.id': wt.id }
  setIfRead(fields, 'worktree.dirty_count', dirty, null)
  setIfRead(fields, 'worktree.git_operation', op)
  setIfRead(fields, 'session.open_from_automation', open)
  return fields
}

export async function addWorktreeFields(
  items: TickItem[],
  automationId: string,
  repoPath: string,
  deps: FactDeps,
  needsFacts: (item: TickItem) => boolean
): Promise<TickItem[]> {
  // A listing failure throws: the tick runner records the tick as failed and the next tick retries.
  const byBranch = new Map((await deps.listWorktrees(repoPath)).map((w) => [w.branch, w]))
  return Promise.all(
    items.map(async (item) => {
      if (!needsFacts(item)) {
        return item
      }
      const wt = byBranch.get(String(item.fields['mr.branch']))
      if (!wt) {
        return { ...item, fields: { ...item.fields, ...NO_WORKTREE } }
      }
      return {
        ...item,
        fields: { ...item.fields, ...(await worktreeFacts(wt, automationId, deps)) }
      }
    })
  )
}
