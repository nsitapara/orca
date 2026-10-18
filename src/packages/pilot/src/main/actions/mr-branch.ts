import type { ItemFields } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { jobCode } from '../../shared/job-name'
import { worktreePathKey } from '../fields/agent-activity'
import { fieldsForRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import type { ActionCaller } from './types'

export type StoreDeps = {
  store: PilotStore
  definitions(): readonly AutomationDefinition[]
}
export type MrBranchDeps = StoreDeps & { exists(path: string): boolean }

// The jobs whose items name an MR with its branch: mark-ready.py's 03–06.
const MR_JOBS: ReadonlySet<string> = new Set(['03', '04', '05', '06'])
// The worktree jobs, whose items say which branch each worktree is on.
const WORKTREE_JOBS: ReadonlySet<string> = new Set(['03', '04'])
// Each automation's newest ticks read, so one failed or empty tick doesn't hide its items.
const RECENT_TICKS = 10

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function namesMr(fields: ItemFields, iid: number): boolean {
  const named = fields['mr.iid']
  return named === iid || named === String(iid)
}

// branchOfRun's rule (inbox/run-fields.ts): an MR item's branch, else a worktree item's.
function branchIn(fields: ItemFields): string | null {
  return text(fields['mr.branch']) ?? text(fields['worktree.branch'])
}

// The items of those jobs' recent ticks, newest tick first.
function recentItems(deps: StoreDeps, codes: ReadonlySet<string>): ItemFields[] {
  const ids = deps
    .definitions()
    .filter((d) => codes.has(jobCode(d.name) ?? ''))
    .map((d) => d.id)
  return ids
    .flatMap((id) => deps.store.listTicks(id, RECENT_TICKS))
    .sort((a, b) => b.startedAt - a.startedAt)
    .flatMap((tick) => deps.store.tickItems(tick.id).map((item) => item.fields))
}

function callerRunId(store: PilotStore, caller: ActionCaller): string | null {
  const card = caller.inboxItemId ? store.inbox.get(caller.inboxItemId) : null
  return card ? card.runId : caller.runId
}

// MR !iid's source branch as Pilot's store knows it: the newest item of jobs 03–06 that names the MR, else the
// asking card's (or run's) own item when it names the MR. Null when the store doesn't say.
export function storeBranchOf(deps: StoreDeps, iid: number, caller: ActionCaller): string | null {
  for (const fields of recentItems(deps, MR_JOBS)) {
    const branch = namesMr(fields, iid) ? branchIn(fields) : null
    if (branch) {
      return branch
    }
  }
  const runId = callerRunId(deps.store, caller)
  const own = runId ? fieldsForRun(deps.store, runId) : {}
  return namesMr(own, iid) ? branchIn(own) : null
}

// The worktrees the newest 03/04 tick that lists each one puts on <branch>, as their items give the path.
export function branchWorktrees(deps: StoreDeps, branch: string): string[] {
  const newest = new Map<string, { path: string; branch: string | null }>()
  for (const fields of recentItems(deps, WORKTREE_JOBS)) {
    const path = text(fields['worktree.path'])
    if (path && !newest.has(worktreePathKey(path))) {
      newest.set(worktreePathKey(path), { path, branch: text(fields['worktree.branch']) })
    }
  }
  return [...newest.values()].filter((w) => w.branch === branch).map((w) => w.path)
}

// A worktree on <branch> whose folder is still there (mark-ready.py's _unpushed found it by source branch), or null.
export function worktreeOn(deps: MrBranchDeps, branch: string): string | null {
  return branchWorktrees(deps, branch).find((path) => deps.exists(path)) ?? null
}
