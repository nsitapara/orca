import { useSyncExternalStore } from 'react'
import { getWorktreeLineageGroupKey } from '../../../../../shared/sidebar-list/group-keys'
import type { Worktree } from '../../../../../shared/worktree/types'

const WORKTREE_GROUP = 'worktree:'
const STORAGE_KEY = 'pilot.activity.folded-worktrees'

/** The Activity group keys (`worktree:<id>`) whose own sessions are folded, kept across relaunches. */
const listeners = new Set<() => void>()
let folded: ReadonlySet<string> | null = null

function read(): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(
      Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []
    )
  } catch {
    return new Set()
  }
}

function current(): ReadonlySet<string> {
  folded ??= read()
  return folded
}

const NONE: ReadonlySet<string> = new Set()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isWorktreeGroupKey(groupKey: string): boolean {
  return groupKey.startsWith(WORKTREE_GROUP)
}

export function useFoldedWorktreeGroups(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, current, () => NONE)
}

function save(next: ReadonlySet<string>): void {
  folded = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Private windows and blocked storage: the fold just doesn't persist.
  }
  for (const listener of listeners) {
    listener()
  }
}

export function toggleWorktreeGroupFold(groupKey: string): void {
  const next = new Set(current())
  if (!next.delete(groupKey)) {
    next.add(groupKey)
  }
  save(next)
}

/** Unfolds a worktree's sessions; a no-op when they aren't folded. */
export function unfoldWorktreeGroup(groupKey: string): void {
  if (current().has(groupKey)) {
    const next = new Set(current())
    next.delete(groupKey)
    save(next)
  }
}

type ChildFoldState = {
  collapsedGroups: ReadonlySet<string>
  worktreesByRepo: Record<string, Worktree[]>
}

/** Whether a worktree's child worktrees are folded, by its id. */
export type ChildrenFoldedOf = (worktreeId: string) => boolean

let cachedChildFold: (ChildFoldState & { foldedOf: ChildrenFoldedOf }) | null = null

/**
 * The Projects sidebar's own "N children" fold (its lineage group), so a worktree's child worktrees
 * fold in Activity and Projects together. Cached on both inputs: every header asks on each store write.
 */
export function childrenFoldedOf(state: ChildFoldState): ChildrenFoldedOf {
  const { collapsedGroups, worktreesByRepo } = state
  if (
    cachedChildFold?.collapsedGroups === collapsedGroups &&
    cachedChildFold.worktreesByRepo === worktreesByRepo
  ) {
    return cachedChildFold.foldedOf
  }
  const byId = new Map(Object.values(worktreesByRepo).flatMap((list) => list.map((w) => [w.id, w])))
  const foldedOf: ChildrenFoldedOf = (worktreeId) => {
    const worktree = byId.get(worktreeId)
    return worktree ? collapsedGroups.has(getWorktreeLineageGroupKey(worktree)) : false
  }
  cachedChildFold = { collapsedGroups, worktreesByRepo, foldedOf }
  return foldedOf
}
