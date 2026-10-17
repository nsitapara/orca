import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import { makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'
import { activateWorkspaceTab } from './activate-workspace-tab'

const activation = vi.hoisted(() => {
  const calls: unknown[][] = []
  const agentSessions: unknown[] = []
  return { calls, agentSessions }
})
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: (...args: unknown[]) => {
    activation.calls.push(args)
    return true
  }
}))
vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: (args: unknown) => activation.agentSessions.push(args)
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({ focusTerminalTabSurface: () => undefined }))

function tab(contentType: Tab['contentType']): Tab {
  return {
    id: 'tab',
    entityId: 'entity',
    worktreeId: 'wt-1',
    groupId: 'g',
    contentType,
    label: 'tab',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function seed(t: Tab | null): void {
  useAppStore.setState({
    activeWorktreeId: 'wt-1',
    groupsByWorktree: {
      'wt-1': [{ id: 'g', worktreeId: 'wt-1', activeTabId: null, tabOrder: t ? [t.id] : [] }]
    },
    unifiedTabsByWorktree: { 'wt-1': t ? [t] : [] }
  })
}

beforeEach(() => {
  activation.calls.length = 0
  activation.agentSessions.length = 0
})

describe('activateWorkspaceTab', () => {
  it.each([
    { contentType: 'terminal', activeTabType: 'terminal' },
    { contentType: 'browser', activeTabType: 'browser' },
    { contentType: 'simulator', activeTabType: 'simulator' },
    { contentType: 'editor', activeTabType: 'editor' }
  ] as const)(
    'opens a $contentType tab and keeps Activity open',
    ({ contentType, activeTabType }) => {
      const t = tab(contentType)
      seed(t)
      useAppStore.setState({ activeTabType: activeTabType === 'terminal' ? 'editor' : 'terminal' })
      const opened = activateWorkspaceTab({
        key: 'k',
        tab: t,
        worktree: makeWorktree(),
        repo: null,
        label: 'tab'
      })
      expect(opened).toBe(true)
      expect(activation.calls[0]?.[1]).toMatchObject({ revealInSidebar: false })
      expect(useAppStore.getState().activeTabType).toBe(activeTabType)
    }
  )

  it('opens an agent session through the structured-session path', () => {
    const t = tab('agent-session')
    seed(t)
    activateWorkspaceTab({ key: 'k', tab: t, worktree: makeWorktree(), repo: null, label: 'tab' })
    expect(activation.agentSessions).toEqual([{ worktreeId: 'wt-1', tabId: 'tab' }])
  })

  it('reports a tab that closed before the click landed', () => {
    seed(null)
    const opened = activateWorkspaceTab({
      key: 'k',
      tab: tab('terminal'),
      worktree: makeWorktree(),
      repo: null,
      label: 'tab'
    })
    expect(opened).toBe(false)
  })
})
