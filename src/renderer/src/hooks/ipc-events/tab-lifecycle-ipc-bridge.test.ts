import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  const listeners: Record<string, (...args: unknown[]) => void> = {}
  return { state, listeners }
})

vi.mock('../../store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/lib/workspace-tab-commands', () => ({ dispatchWorkspaceTabCommand: vi.fn() }))
vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  createFloatingWorkspaceTerminalTab: vi.fn(),
  isFloatingWorkspacePanelFocused: () => false,
  resolveFloatingWorkspaceBrowserWorkspaceId: vi.fn()
}))
vi.mock('@/lib/floating-workspace-guest-bridge', () => ({
  dispatchFloatingWorkspaceGuestClose: vi.fn(),
  dispatchFloatingWorkspaceGuestSelectIndex: vi.fn()
}))

import { registerTabLifecycleIpcBridge } from './tab-lifecycle-ipc-bridge'

describe('registerTabLifecycleIpcBridge new terminal tab', () => {
  beforeEach(() => {
    mocks.listeners = {}
    const ui = new Proxy(
      {},
      {
        get: (_target, name) => (listener: (...args: unknown[]) => void) => {
          mocks.listeners[String(name)] = listener
          return () => {}
        }
      }
    )
    vi.stubGlobal('window', { api: { ui } })
  })

  it.each([
    { activeWorktreeId: 'repo-1::/repo/worktree', opensPicker: true },
    { activeWorktreeId: null, opensPicker: false }
  ])(
    'opens the agent picker only with an active workspace ($activeWorktreeId)',
    ({ activeWorktreeId, opensPicker }) => {
      const openModal = vi.fn()
      mocks.state = { activeWorktreeId, openModal }
      registerTabLifecycleIpcBridge([])
      mocks.listeners.onNewTerminalTab()
      expect(openModal.mock.calls).toEqual(opensPicker ? [['new-tab-agent-picker']] : [])
    }
  )
})
