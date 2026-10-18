// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '@/store'
import { createGlobalSettingsFixture } from '../../../../../shared/global-settings-test-fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NewAgentMenu } from './NewAgentMenu'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'

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
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(() => ({ primaryTabId: null }))
}))

const menu = () => (
  <TooltipProvider>
    <NewAgentMenu worktreeId="wt-1" />
  </TooltipProvider>
)

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
    const view = render(menu())
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
  const view = render(menu())
  await user.click(view.getByRole('button', { name: 'New agent' }))
  detection.ids = ['claude', 'codex']
  view.rerender(menu())
  await waitFor(() => expect(view.getByRole('menuitem', { name: /Claude/ })).toBeTruthy())
  await user.keyboard('{Enter}')
  expect(launchAgentInNewTab).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
})

// A recent worktree with no tabs has no group: opening the menu makes its root one for the launch.
it('a worktree with no tab group gets one when the menu opens, and the agent launches there', async () => {
  useAppStore.setState({ activeGroupIdByWorktree: {}, groupsByWorktree: {} })
  const user = userEvent.setup()
  const view = render(menu())
  await user.click(view.getByRole('button', { name: 'New agent' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'))
  await user.keyboard('{Enter}')
  const groupId = useAppStore.getState().groupsByWorktree['wt-1']?.[0]?.id
  expect(groupId).toBeTruthy()
  expect(launchAgentInNewTab).toHaveBeenCalledWith(
    expect.objectContaining({ agent: 'claude', worktreeId: 'wt-1', groupId })
  )
})

// Why: Activity lists worktrees other than the open one; a launch there must bring it into view.
it('switches to the worktree as the new tab opens, without seeding a shell beside it', async () => {
  useAppStore.setState({ activeWorktreeId: 'wt-other' })
  const user = userEvent.setup()
  const view = render(menu())
  await user.click(view.getByRole('button', { name: 'New agent' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'))
  await user.keyboard('{Enter}')
  expect(activateAndRevealWorkspace).not.toHaveBeenCalled()

  const [args] = vi.mocked(launchAgentInNewTab).mock.calls[0] ?? []
  expect(args?.beforeSurfaceOpen?.({ kind: 'local-terminal' })).toBe(true)

  expect(activateAndRevealWorkspace).toHaveBeenCalledWith('wt-1', {
    providesInitialSurface: true,
    revealInSidebar: false
  })
})
