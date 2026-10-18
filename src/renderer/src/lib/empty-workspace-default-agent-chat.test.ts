import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../shared/constants'
import { useAppStore } from '@/store'
import {
  emptyWorkspaceDefaultAgentAwaitsDetection,
  loadEmptyWorkspaceDefaultAgentDetection,
  openDefaultAgentInEmptyWorkspace
} from './empty-workspace-default-agent-chat'

const mocks = vi.hoisted(() => ({
  launchAgentInNewTab: vi.fn(),
  planAgentSessionLaunch: vi.fn(),
  detectionTargetKey: vi.fn<() => string | undefined>()
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
vi.mock('@/lib/agent-session-launch-plan', () => ({
  planAgentSessionLaunch: mocks.planAgentSessionLaunch
}))
vi.mock('@/hooks/useAgentDetectionTarget', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDetectionTargetKeyForWorktree: mocks.detectionTargetKey
}))

const initialAppStoreState = useAppStore.getState()

function seedSettings(settings: Partial<GlobalSettings>): void {
  useAppStore.setState({
    detectedAgentIds: ['claude', 'codex'],
    settings: {
      ...getDefaultSettings('/tmp'),
      experimentalNativeChat: true,
      defaultTuiAgent: 'codex',
      disabledTuiAgents: [],
      ...settings
    }
  })
}

beforeEach(() => {
  mocks.detectionTargetKey.mockReturnValue('local')
  mocks.planAgentSessionLaunch.mockReturnValue({ route: 'structured-native-chat' })
  mocks.launchAgentInNewTab.mockReturnValue({
    surface: { kind: 'host-published' }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  useAppStore.setState(initialAppStoreState, true)
})

describe('openDefaultAgentInEmptyWorkspace', () => {
  it('launches the default agent as a chat', () => {
    seedSettings({})

    // The chat's tab opens once its host admits it, so none is primary yet.
    expect(openDefaultAgentInEmptyWorkspace('wt-1')).toEqual({ primaryTabId: null })
    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', worktreeId: 'wt-1', pendingActivationSpawn: true })
    )
  })

  // Why: the user asked for the agent, so a host's "no" to the chat opens its terminal, not a shell.
  it('leaves a declined chat to open as the agent terminal', () => {
    seedSettings({})

    openDefaultAgentInEmptyWorkspace('wt-1')

    expect(mocks.launchAgentInNewTab.mock.calls[0]?.[0]).not.toHaveProperty(
      'onStructuredHostDeclined'
    )
  })

  it('opens the default agent in its terminal when chat is off', () => {
    seedSettings({ experimentalNativeChat: false })
    mocks.planAgentSessionLaunch.mockReturnValue({ route: 'terminal-tui' })
    mocks.launchAgentInNewTab.mockReturnValue({
      surface: { kind: 'local-terminal', tabId: 'agent-tab' }
    })

    expect(openDefaultAgentInEmptyWorkspace('wt-1')).toEqual({ primaryTabId: 'agent-tab' })
    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        agentSessionLaunchPlan: { route: 'terminal-tui' },
        pendingActivationSpawn: true
      })
    )
  })

  it.each([
    ['Terminal is the empty-workspace choice', { emptyWorkspaceOpenSurface: 'terminal' as const }],
    ['the default agent is Blank Terminal', { defaultTuiAgent: 'blank' as const }]
  ])('leaves the shell to the caller when %s', (_label, settings) => {
    seedSettings(settings)

    expect(openDefaultAgentInEmptyWorkspace('wt-1')).toBeNull()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('reads the agents detected on the workspace SSH host', () => {
    seedSettings({})
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    useAppStore.setState({ remoteDetectedAgentIds: { 'conn-1': ['claude'] } })

    openDefaultAgentInEmptyWorkspace('wt-1')

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude' })
    )
  })

  it('treats a workspace whose host is unresolved as unknown', () => {
    seedSettings({})
    mocks.detectionTargetKey.mockReturnValue(undefined)

    expect(emptyWorkspaceDefaultAgentAwaitsDetection('wt-1')).toBe(false)
    expect(openDefaultAgentInEmptyWorkspace('wt-1')).toBeNull()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })
})

describe('agent detection for the default agent', () => {
  it.each([
    ['chat is on', {}],
    ['chat is off', { experimentalNativeChat: false }]
  ])('waits only while the host list has not loaded when %s', (_label, settings) => {
    seedSettings(settings)
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    useAppStore.setState({ remoteDetectedAgentIds: {} })
    expect(emptyWorkspaceDefaultAgentAwaitsDetection('wt-1')).toBe(true)

    useAppStore.setState({ remoteDetectedAgentIds: { 'conn-1': [] } })
    expect(emptyWorkspaceDefaultAgentAwaitsDetection('wt-1')).toBe(false)
  })

  // Why: these open a shell whatever the host has, so waiting only delays that shell.
  it.each([
    ['Terminal is the empty-workspace choice', { emptyWorkspaceOpenSurface: 'terminal' as const }],
    ['the default agent is Blank Terminal', { defaultTuiAgent: 'blank' as const }]
  ])('does not wait when %s', (_label, settings) => {
    seedSettings(settings)
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    useAppStore.setState({ remoteDetectedAgentIds: {} })

    expect(emptyWorkspaceDefaultAgentAwaitsDetection('wt-1')).toBe(false)
  })

  it('probes the workspace host and gives up after a bounded wait', async () => {
    vi.useFakeTimers()
    seedSettings({})
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    const ensureRemoteDetectedAgents = vi.fn(() => new Promise<never>(() => {}))
    useAppStore.setState({ ensureRemoteDetectedAgents })
    let settled = false

    void loadEmptyWorkspaceDefaultAgentDetection('wt-1').then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(ensureRemoteDetectedAgents).toHaveBeenCalledWith('conn-1')
    expect(settled).toBe(true)
  })
})
