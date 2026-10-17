import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import {
  clearClientHostedBrowserRowSelection,
  getClientHostedBrowserRows,
  selectClientHostedBrowserRow
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session-environment'
import { activateWebRuntimeSessionTab } from '@/runtime/web-runtime-session-tab-lifecycle'
import { useAppStore } from '@/store'
import type { WorkspaceTabItem } from './workspace-tab-items'

function findGroup(worktreeId: string, groupId: string) {
  return useAppStore.getState().groupsByWorktree[worktreeId]?.find((g) => g.id === groupId)
}

function activateClientHostedRow({ tab }: WorkspaceTabItem): boolean {
  if (
    !findGroup(tab.worktreeId, tab.groupId) ||
    !getClientHostedBrowserRows(tab.worktreeId).some((row) => row.browserPageId === tab.id)
  ) {
    return false
  }
  if (!activateAndRevealWorkspace(tab.worktreeId, { revealInSidebar: false })) {
    return false
  }
  useAppStore.getState().focusGroup(tab.worktreeId, tab.groupId)
  // Activation can seed a terminal into an empty workspace; the selection must outrank it.
  const group = findGroup(tab.worktreeId, tab.groupId)
  if (!group) {
    return false
  }
  selectClientHostedBrowserRow({
    worktreeId: tab.worktreeId,
    groupId: tab.groupId,
    browserPageId: tab.id,
    groupActiveTabIdAtSelection: group.activeTabId
  })
  return true
}

// Mirrors activateWorkspaceTabPaletteResult, but keeps Activity open and opens every tab kind.
export function activateWorkspaceTab(item: WorkspaceTabItem): boolean {
  if (item.clientHostedRow) {
    return activateClientHostedRow(item)
  }
  clearClientHostedBrowserRowSelection()
  const { tab } = item
  const executionHostId = tab.executionHostId ?? getPaletteWorktreeExecutionHostId(item.worktree)
  const activated = executionHostId
    ? activateAndRevealWorkspace(tab.worktreeId, { executionHostId, revealInSidebar: false })
    : activateAndRevealWorkspace(tab.worktreeId, { revealInSidebar: false })
  const state = useAppStore.getState()
  const live = state.unifiedTabsByWorktree[tab.worktreeId]?.some((t) => t.id === tab.id)
  if (!activated || !live || !findGroup(tab.worktreeId, tab.groupId)) {
    return false
  }
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, tab.worktreeId)
  state.focusGroup(tab.worktreeId, tab.groupId)
  state.activateTab(tab.id, { worktreeId: tab.worktreeId })
  switch (tab.contentType) {
    case 'agent-session':
      activateStructuredAgentSessionTab({ worktreeId: tab.worktreeId, tabId: tab.id })
      return true
    case 'browser':
      if (
        isWebRuntimeSessionActive(environmentId) &&
        browserWorkspaceHasRemoteOwner(state, tab.entityId, environmentId)
      ) {
        void activateWebRuntimeSessionTab({
          worktreeId: tab.worktreeId,
          tabId: tab.id,
          environmentId
        })
      }
      state.setActiveBrowserTab(tab.entityId)
      state.setActiveTabType('browser', tab.worktreeId)
      return true
    case 'simulator':
      state.setActiveTabType('simulator', tab.worktreeId)
      return true
    case 'terminal':
      if (isWebRuntimeSessionActive(environmentId)) {
        void activateWebRuntimeSessionTab({
          worktreeId: tab.worktreeId,
          tabId: tab.entityId,
          environmentId
        })
      }
      state.setActiveTab(tab.entityId)
      state.setActiveTabType('terminal', tab.worktreeId)
      focusTerminalTabSurface(tab.entityId)
      return true
    case 'editor':
    case 'diff':
    case 'conflict-review':
    case 'check-details':
      state.setActiveFile(tab.entityId)
      // setActiveFile may pick an editor tab for the same entity instead of this diff.
      state.activateTab(tab.id, { worktreeId: tab.worktreeId })
      state.setActiveTabType('editor', tab.worktreeId)
      return true
  }
}
