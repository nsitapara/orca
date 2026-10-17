import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { state }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))

import { persistAgentLaunchTabOrder } from './launch-agent-tab-order'

const WORKTREE_ID = 'repo-1::/repo/worktree'

describe('persistAgentLaunchTabOrder', () => {
  it('appends the new terminal to the saved order, dropping repeated ids', () => {
    const setTabBarOrder = vi.fn()
    mocks.state = {
      tabsByWorktree: { [WORKTREE_ID]: [{ id: 'term-a' }, { id: 'term-new' }] },
      openFiles: [],
      browserTabsByWorktree: { [WORKTREE_ID]: [{ id: 'browser-1' }] },
      tabBarOrderByWorktree: { [WORKTREE_ID]: ['browser-1', 'term-a', 'browser-1'] },
      setTabBarOrder
    }
    persistAgentLaunchTabOrder(WORKTREE_ID, 'term-new')
    expect(setTabBarOrder).toHaveBeenCalledWith(WORKTREE_ID, ['browser-1', 'term-a', 'term-new'])
  })
})
