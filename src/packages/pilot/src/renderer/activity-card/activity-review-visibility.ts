import { useEffect } from 'react'
import { pilotStore } from '../store'

// Activity, Recent and Waiting rows show review chips outside the Workspaces list, whose viewport is
// upstream's only source of on-screen reviews; without this their merged MRs never refresh.
const mountedRows = new Map<string, number>()
let listIds: readonly string[] = []

/** The Workspaces list's on-screen ids plus every mounted Activity row's, for the visible review set. */
export function withActivityReviewWorktreeIds(ids: readonly string[]): readonly string[] {
  listIds = ids
  const extra = [...mountedRows.keys()].filter((id) => !ids.includes(id)).sort()
  return extra.length ? [...ids, ...extra] : ids
}

function republish(): void {
  pilotStore()?.getState().setVisibleReviewCardWorktreeIds?.(listIds)
}

/** Holds a worktree in the visible review set while the row showing its review is mounted. */
export function useActivityReviewVisibility(worktreeId: string): void {
  useEffect(() => {
    mountedRows.set(worktreeId, (mountedRows.get(worktreeId) ?? 0) + 1)
    republish()
    return () => {
      const count = (mountedRows.get(worktreeId) ?? 1) - 1
      if (count > 0) {
        mountedRows.set(worktreeId, count)
      } else {
        mountedRows.delete(worktreeId)
      }
      republish()
    }
  }, [worktreeId])
}
