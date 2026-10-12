import { useSyncExternalStore } from 'react'
import { pilotStore } from '../store'

// Orca's active worktree as a path, or null: none open, a folder workspace, or Pilot not attached yet (R9).
export function activeWorktreePath(): string | null {
  const state = pilotStore()?.getState()
  const id = state?.activeWorktreeId
  if (!id) {
    return null
  }
  return state?.getKnownWorktreeById?.(id)?.path ?? null
}

function subscribe(listener: () => void): () => void {
  return pilotStore()?.subscribe?.(listener) ?? (() => {})
}

export function useActiveWorktreePath(): string | null {
  return useSyncExternalStore(subscribe, activeWorktreePath, () => null)
}
