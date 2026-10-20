import { useShallow } from 'zustand/react/shallow'
import { resolveOpenTabOccupantAgent } from '@/lib/open-tab-occupant-agent'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { WorkspaceTabItem } from './workspace-tab-items'

type AgentSignals = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'sleepingAgentSessionsByPaneKey'
  | 'paneForegroundAgentByPaneKey'
>

/** A terminal tab with no agent in it, by the tab strip's identity rules (hook, process, title, launch). */
export function isPlainTerminalTab(item: WorkspaceTabItem, s: AgentSignals): boolean {
  const { tab } = item
  if (tab.contentType !== 'terminal') {
    return false
  }
  const terminal = s.tabsByWorktree[tab.worktreeId]?.find((t) => t.id === tab.entityId)
  const agent = resolveOpenTabOccupantAgent({
    tabId: tab.entityId,
    title: item.label,
    defaultTitle: terminal?.defaultTitle,
    launchAgent: terminal?.launchAgent,
    layout: s.terminalLayoutsByTabId[tab.entityId],
    agentStatusByPaneKey: s.agentStatusByPaneKey,
    retainedAgentsByPaneKey: s.retainedAgentsByPaneKey,
    sleepingAgentSessionsByPaneKey: s.sleepingAgentSessionsByPaneKey,
    paneForegroundAgentByPaneKey: s.paneForegroundAgentByPaneKey
  })
  return agent === null
}

/** With `hideTerminals`, the tabs less every terminal with no agent in it. */
export function useAgentTabItems(
  tabs: readonly WorkspaceTabItem[],
  hideTerminals: boolean
): readonly WorkspaceTabItem[] {
  return useAppStore(
    useShallow((s) => (hideTerminals ? tabs.filter((item) => !isPlainTerminalTab(item, s)) : tabs))
  )
}
