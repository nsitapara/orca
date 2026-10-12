// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPilotStore } from '../store'
import { activeWorktreePath, useActiveWorktreePath } from './active-worktree'

function fakeStore(activeWorktreeId: string | null) {
  const listeners = new Set<() => void>()
  const state = {
    rightSidebarOpen: true,
    setRightSidebarOpen: () => {},
    activeWorktreeId,
    getKnownWorktreeById: (id: string) => (id === 'repo::/wt/a' ? { path: '/wt/a' } : undefined)
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
    ['Pilot not attached', null, null],
    ['no worktree open', 'none', null],
    ['a folder workspace Orca knows no worktree for', 'folder:abc', null],
    ['a worktree', 'repo::/wt/a', '/wt/a']
  ])('%s → %s', (_name, id, path) => {
    if (id !== null) {
      registerPilotStore(fakeStore(id === 'none' ? null : id).store)
    }
    expect(activeWorktreePath()).toBe(path)
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
})
