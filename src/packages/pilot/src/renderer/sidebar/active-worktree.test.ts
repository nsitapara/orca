// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPilotStore } from '../store'
import {
  activeProjectName,
  activeWorktreeName,
  activeWorktreePath,
  useActiveWorktreeNames,
  useActiveWorktreePath
} from './active-worktree'

const WORKTREES = [
  { path: '/wt/a', displayName: 'vite-plus-spike', repoId: 'repo' },
  { path: '/wt/b', displayName: 'orphan', repoId: 'gone' }
]

function fakeStore(activeWorktreeId: string | null) {
  const listeners = new Set<() => void>()
  const state = {
    rightSidebarOpen: true,
    setRightSidebarOpen: () => {},
    activeWorktreeId,
    getKnownWorktreeById: (id: string) => WORKTREES.find((w) => `${w.repoId}::${w.path}` === id),
    repos: [{ id: 'repo', displayName: 'web-platform' }]
  }
  return {
    state,
    store: {
      getState: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => {
          listeners.delete(l)
        }
      }
    },
    emit: () => listeners.forEach((l) => l())
  }
}

describe('the active worktree', () => {
  afterEach(() => registerPilotStore(null))

  it.each([
    ['Pilot not attached', null, null, null, null],
    ['no worktree open', 'none', null, null, null],
    ['a folder workspace Orca knows no worktree for', 'folder:abc', null, null, null],
    ['a worktree', 'repo::/wt/a', '/wt/a', 'vite-plus-spike', 'web-platform'],
    ['a worktree whose project is gone', 'gone::/wt/b', '/wt/b', 'orphan', null]
  ])('%s → %s', (_name, id, path, worktree, project) => {
    if (id !== null) {
      registerPilotStore(fakeStore(id === 'none' ? null : id).store)
    }
    expect(activeWorktreePath()).toBe(path)
    expect(activeWorktreeName()).toBe(worktree)
    expect(activeProjectName()).toBe(project)
  })

  it('follows Orca when the active worktree changes', () => {
    const fake = fakeStore(null)
    registerPilotStore(fake.store)
    const { result } = renderHook(() => useActiveWorktreePath())
    expect(result.current).toBeNull()
    act(() => {
      fake.state.activeWorktreeId = 'repo::/wt/a'
      fake.emit()
    })
    expect(result.current).toBe('/wt/a')
  })

  it("follows Orca's active worktree with its names", () => {
    const fake = fakeStore(null)
    registerPilotStore(fake.store)
    const { result } = renderHook(() => useActiveWorktreeNames())
    expect(result.current).toEqual({ worktree: null, project: null })
    act(() => {
      fake.state.activeWorktreeId = 'repo::/wt/a'
      fake.emit()
    })
    expect(result.current).toEqual({ worktree: 'vite-plus-spike', project: 'web-platform' })
  })
})
