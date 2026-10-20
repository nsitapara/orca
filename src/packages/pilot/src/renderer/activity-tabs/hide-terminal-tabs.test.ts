import { describe, expect, it } from 'vitest'
import type { TabContentType } from '../../../../../shared/tab-types'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import {
  makeTabWithIds,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { isPlainTerminalTab } from './hide-terminal-tabs'
import type { WorkspaceTabItem } from './workspace-tab-items'

function item(contentType: TabContentType, label: string): WorkspaceTabItem {
  return {
    key: 'k',
    label,
    worktree: makeWorktreeWithId('wt-a'),
    repo: null,
    tab: {
      id: 'unified-1',
      entityId: 'term-1',
      worktreeId: 'wt-a',
      groupId: 'g',
      contentType,
      label,
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
  }
}

function signals(launchAgent?: TuiAgent) {
  return {
    tabsByWorktree: { 'wt-a': [{ ...makeTabWithIds('term-1', 'wt-a', 'zsh'), launchAgent }] },
    terminalLayoutsByTabId: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    paneForegroundAgentByPaneKey: {}
  }
}

describe('isPlainTerminalTab', () => {
  it.each([
    { name: 'a shell terminal', contentType: 'terminal', label: 'Stack', plain: true },
    {
      name: 'a terminal Claude was launched in',
      contentType: 'terminal',
      label: 'Terminal 1',
      launchAgent: 'claude',
      plain: false
    },
    {
      name: 'a terminal titled by Claude',
      contentType: 'terminal',
      label: '✳ Claude Code',
      plain: false
    },
    { name: 'a browser tab', contentType: 'browser', label: 'localhost:3000', plain: false }
  ] as const)('$name → plain: $plain', ({ contentType, label, plain, ...rest }) => {
    const launchAgent = 'launchAgent' in rest ? rest.launchAgent : undefined
    expect(isPlainTerminalTab(item(contentType, label), signals(launchAgent))).toBe(plain)
  })
})
