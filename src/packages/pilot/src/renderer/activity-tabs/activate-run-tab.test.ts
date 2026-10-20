import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import { makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'

const activateWorkspaceTab = vi.fn()
vi.mock('./activate-workspace-tab', () => ({
  activateWorkspaceTab: (...args: unknown[]) => activateWorkspaceTab(...args)
}))

import { activateRunTab } from './activate-run-tab'

const worktree = makeWorktree()
const terminal: Tab = {
  id: 'unified-1',
  entityId: 'tab-1',
  worktreeId: worktree.id,
  groupId: 'g',
  contentType: 'terminal',
  label: 'claude',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}

function seed(worktrees: (typeof worktree)[], tabs: Tab[]): void {
  useAppStore.setState({
    worktreesByRepo: { [worktree.repoId]: worktrees },
    unifiedTabsByWorktree: { [worktree.id]: tabs }
  })
}

beforeEach(() => activateWorkspaceTab.mockReset().mockReturnValue(true))

describe('activateRunTab', () => {
  it('opens the terminal tab a pane key names, in the worktree at that path', () => {
    seed([worktree], [terminal])
    expect(activateRunTab({ worktreePath: worktree.path, tabId: 'tab-1' })).toBe(true)
    expect(activateWorkspaceTab).toHaveBeenCalledWith(
      expect.objectContaining({ tab: terminal, worktree })
    )
  })

  it.each([
    { name: 'the worktree is gone', path: '/elsewhere', tabs: [terminal] },
    { name: 'the tab is closed', path: worktree.path, tabs: [] }
  ])('opens nothing when $name', ({ path, tabs }) => {
    seed([worktree], tabs)
    expect(activateRunTab({ worktreePath: path, tabId: 'tab-1' })).toBe(false)
    expect(activateWorkspaceTab).not.toHaveBeenCalled()
  })
})
