import { EVERY_AGENT_CHAT } from '../../../../../../shared/native-chat/every-agent-chat.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../../../../shared/constants'
import { useAppStore } from '@/store'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/hosts/capabilities/local-runtime-capabilities'
import {
  emptyWorkspaceDefaultChatAwaitsDetection,
  loadEmptyWorkspaceDefaultChatDetection,
  openDefaultAgentChatInEmptyWorkspace
} from './empty-workspace-default-agent-chat'

const mocks = vi.hoisted(() => ({
  launchAgentInNewTab: vi.fn(),
  planAgentSessionLaunch: vi.fn(),
  detectionTargetKey: vi.fn<() => string | undefined>()
}))

vi.mock('@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab', () => ({
  launchAgentInNewTabWithOutcome: mocks.launchAgentInNewTab
}))
vi.mock('@/lib/agent-session/launch/routing/agent-session-launch-plan', () => ({
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
      nativeChatProviders: EVERY_AGENT_CHAT,
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
  setLocalRuntimeCapabilitiesForTests(null)
  useAppStore.setState(initialAppStoreState, true)
})

const CHAT_OFF = { nativeChatProviders: {} }

describe('openDefaultAgentChatInEmptyWorkspace', () => {
  // Why: the user asked for the agent, so a host's "no" to the chat opens its terminal, not a shell.
  it('leaves a declined chat to open as the agent terminal', () => {
    seedSettings({})

    openDefaultAgentChatInEmptyWorkspace('wt-1')

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledOnce()
    expect(mocks.launchAgentInNewTab.mock.calls[0]?.[0]).not.toHaveProperty(
      'onStructuredHostDeclined'
    )
  })

  it('opens the default agent in its terminal when chat is off', () => {
    seedSettings(CHAT_OFF)
    mocks.planAgentSessionLaunch.mockReturnValue({ route: 'terminal-tui' })
    mocks.launchAgentInNewTab.mockReturnValue({
      surface: { kind: 'local-terminal', tabId: 'agent-tab' }
    })

    expect(openDefaultAgentChatInEmptyWorkspace('wt-1')).toEqual({ primaryTabId: 'agent-tab' })
    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        agentSessionLaunchPlan: { route: 'terminal-tui' },
        pendingActivationSpawn: true
      })
    )
  })

  it('leaves the shell to the caller when Terminal is the empty-workspace choice', () => {
    seedSettings({ emptyWorkspaceOpenSurface: 'terminal' })

    expect(openDefaultAgentChatInEmptyWorkspace('wt-1')).toBeNull()
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
  })
})

describe('agent detection for the default chat', () => {
  it('waits while the host list has not loaded even when chat is off', () => {
    seedSettings(CHAT_OFF)
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    useAppStore.setState({ remoteDetectedAgentIds: {} })
    expect(emptyWorkspaceDefaultChatAwaitsDetection('wt-1')).toBe(true)

    useAppStore.setState({ remoteDetectedAgentIds: { 'conn-1': [] } })
    expect(emptyWorkspaceDefaultChatAwaitsDetection('wt-1')).toBe(false)
  })

  // Why: Terminal opens a shell whatever the host has, so waiting only delays that shell.
  it('does not wait when Terminal is the empty-workspace choice', () => {
    seedSettings({ emptyWorkspaceOpenSurface: 'terminal' })
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    useAppStore.setState({ remoteDetectedAgentIds: {} })

    expect(emptyWorkspaceDefaultChatAwaitsDetection('wt-1')).toBe(false)
  })

  it('probes the workspace host and gives up after a bounded wait', async () => {
    vi.useFakeTimers()
    seedSettings({})
    mocks.detectionTargetKey.mockReturnValue('ssh:conn-1')
    const ensureRemoteDetectedAgents = vi.fn(() => new Promise<never>(() => {}))
    useAppStore.setState({ ensureRemoteDetectedAgents })
    let settled = false

    void loadEmptyWorkspaceDefaultChatDetection('wt-1').then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(ensureRemoteDetectedAgents).toHaveBeenCalledWith('conn-1')
    expect(settled).toBe(true)
  })
})
