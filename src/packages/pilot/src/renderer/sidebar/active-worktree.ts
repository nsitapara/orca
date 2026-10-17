import { useSyncExternalStore } from 'react'
import { pilotStore } from '../store'

function activeWorktree() {
  const state = pilotStore()?.getState()
  const id = state?.activeWorktreeId
  if (!id) {
    return undefined
  }
  return state?.getKnownWorktreeById?.(id)
}

// Orca's active worktree as a path, or null: none open, a folder workspace, or Pilot not attached yet (R9).
export function activeWorktreePath(): string | null {
  return activeWorktree()?.path ?? null
}

export function activeWorktreeName(): string | null {
  return activeWorktree()?.displayName || null
}

export function activeProjectName(): string | null {
  const repoId = activeWorktree()?.repoId
  const repos = pilotStore()?.getState().repos
  return repos?.find((r) => r.id === repoId)?.displayName || null
}

function subscribe(listener: () => void): () => void {
  return pilotStore()?.subscribe?.(listener) ?? (() => {})
}

export function useActiveWorktreePath(): string | null {
  return useSyncExternalStore(subscribe, activeWorktreePath, () => null)
}

export function useActiveWorktreeNames(): { worktree: string | null; project: string | null } {
  const worktree = useSyncExternalStore(subscribe, activeWorktreeName, () => null)
  const project = useSyncExternalStore(subscribe, activeProjectName, () => null)
  return { worktree, project }
}
