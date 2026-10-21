import type { WorktreeLineage } from '../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getSidebarLineageRowsByIdentity } from '../../../../../shared/sidebar-list/pinned-section-worktrees'
import {
  getCyclicProjectedWorktreeLineageIds,
  getSidebarLineageParent
} from '../../../../../shared/sidebar-list/worktree-lineage-projection'
import { getLineageAncestorIndex } from '@/components/sidebar/visible-worktree-indexes'
import { useAppStore } from '@/store'

const WORKTREE_GROUP = 'worktree:'

/** The worktree a worktree's Activity group nests under: its parent in Orca's lineage. */
export type WorktreeParent = { id: string; label: string }
export type WorktreeParentOf = (worktreeId: string) => WorktreeParent | null

type LineageState = {
  worktreesByRepo: Record<string, Worktree[]>
  worktreeLineageById: Readonly<Record<string, WorktreeLineage>>
}

// Why cached on both inputs: the header and every nested row ask on each store write.
let cached: (LineageState & { parentOf: WorktreeParentOf }) | null = null

/** The Projects sidebar's lineage rules (same host, live instances, no cycle), read off the app store. */
export function worktreeParentOf(state: LineageState): WorktreeParentOf {
  const { worktreesByRepo, worktreeLineageById } = state
  if (
    cached?.worktreesByRepo === worktreesByRepo &&
    cached.worktreeLineageById === worktreeLineageById
  ) {
    return cached.parentOf
  }
  const index = getLineageAncestorIndex(worktreesByRepo)
  const rowsByIdentity = getSidebarLineageRowsByIdentity([], index)
  const cyclic = getCyclicProjectedWorktreeLineageIds(worktreeLineageById, index)
  const parentOf: WorktreeParentOf = (worktreeId) => {
    const worktree = index.get(worktreeId)
    if (!worktree || cyclic.has(worktreeId)) {
      return null
    }
    const parent = getSidebarLineageParent(worktree, worktreeLineageById, rowsByIdentity)
    return parent && parent.id !== worktreeId ? { id: parent.id, label: parent.displayName } : null
  }
  cached = { worktreesByRepo, worktreeLineageById, parentOf }
  return parentOf
}

/** How many ancestors a worktree's group sits under; 0 for one with no parent. */
export function worktreeNestDepth(parentOf: WorktreeParentOf, worktreeId: string): number {
  const seen = new Set([worktreeId])
  let depth = 0
  for (let parent = parentOf(worktreeId); parent && !seen.has(parent.id);) {
    seen.add(parent.id)
    depth += 1
    parent = parentOf(parent.id)
  }
  return depth
}

/** The nest depth of a worktree group's header and rows; 0 for any other group. */
export function useWorktreeGroupNestDepth(groupKey: string): number {
  return useAppStore((state) =>
    groupKey.startsWith(WORKTREE_GROUP)
      ? worktreeNestDepth(worktreeParentOf(state), groupKey.slice(WORKTREE_GROUP.length))
      : 0
  )
}
