// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '@/store'
import { createGlobalSettingsFixture } from '../../../../../shared/global-settings-test-fixture'
import { WorkspaceActions } from './WorkspaceActions'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'

vi.mock('@/components/tab-bar/TabBarQuickCommandsButton', () => ({
  TabBarQuickCommandsButton: () => null
}))
vi.mock('@/components/tab-group/useTabGroupWorkspaceModel', () => ({
  useTabGroupWorkspaceModel: () => ({ commands: {} })
}))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => null
}))
const detection = vi.hoisted(() => {
  const state: { ids: string[] | null } = { ids: ['claude', 'codex'] }
  return state
})
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: detection.ids })
}))
vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
vi.mock('@/lib/structured-agent-session-launch', () => ({
  useStructuredAgentLaunchStatus: () => null
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: vi.fn(() => ({ surface: { kind: 'remote-terminal' } }))
}))

beforeEach(() => {
  detection.ids = ['claude', 'codex']
  useAppStore.setState({
    settings: {
      ...createGlobalSettingsFixture(),
      defaultTuiAgent: 'claude',
      disabledTuiAgents: []
    },
    activeWorktreeId: 'wt-1',
    activeGroupIdByWorktree: { 'wt-1': 'group-1' },
    groupsByWorktree: {
      'wt-1': [{ id: 'group-1', worktreeId: 'wt-1', activeTabId: null, tabOrder: [] }]
    }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it.each([
  { defaultAgent: 'claude', keys: '{Enter}', expected: 'claude' },
  { defaultAgent: 'claude', keys: '{ArrowDown}{Enter}', expected: 'codex' },
  { defaultAgent: 'codex', keys: '{Enter}', expected: 'codex' }
] as const)(
  'launches $expected with $keys and saved default $defaultAgent',
  async ({ defaultAgent, keys, expected }) => {
    useAppStore.setState({
      settings: {
        ...createGlobalSettingsFixture(),
        defaultTuiAgent: defaultAgent,
        disabledTuiAgents: []
      }
    })
    const user = userEvent.setup()
    const view = render(<WorkspaceActions />)
    await user.click(view.getByRole('button', { name: 'New agent' }))
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'))
    await user.keyboard(keys)
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: expected, worktreeId: 'wt-1', groupId: 'group-1' })
    )
  }
)

it('selects the default when agent detection finishes after opening the menu', async () => {
  detection.ids = null
  const user = userEvent.setup()
  const view = render(<WorkspaceActions />)
  await user.click(view.getByRole('button', { name: 'New agent' }))
  detection.ids = ['claude', 'codex']
  view.rerender(<WorkspaceActions />)
  await waitFor(() => expect(view.getByRole('menuitem', { name: /Claude/ })).toBeTruthy())
  await user.keyboard('{Enter}')
  expect(launchAgentInNewTab).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
})

it.each([
  { item: 'Split right', direction: 'right' },
  { item: 'Split down', direction: 'down' }
])(
  '$item opens a terminal in a new split through the workspace’s host',
  async ({ item, direction }) => {
    const createEmptySplitGroup = vi.fn(() => 'group-2')
    const openNewTerminalTabInActiveWorkspace = vi.fn(async () => undefined)
    useAppStore.setState({ createEmptySplitGroup, openNewTerminalTabInActiveWorkspace })
    const user = userEvent.setup()
    const view = render(<WorkspaceActions />)
    await user.click(view.getByRole('button', { name: 'New tab' }))
    await user.click(await view.findByRole('menuitem', { name: item }))
    expect(createEmptySplitGroup).toHaveBeenCalledWith('wt-1', 'group-1', direction)
    expect(openNewTerminalTabInActiveWorkspace).toHaveBeenCalledWith('group-2')
  }
)
