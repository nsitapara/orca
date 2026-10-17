import { File, FileDiff, Globe, Pin, Smartphone, Terminal, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TerminalAgent } from '../../../../../shared/terminal-agent'
import type { Tab } from '../../../../../shared/tab-types'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { useActiveClientHostedBrowserRowId } from '@/lib/pane-manager/client-hosted-browser-row-state'
import { isPaletteCurrentWorktree } from '@/lib/palette-repo-resolution'
import { cn } from '@/lib/utils'
import { dispatchWorkspaceTabCommand } from '@/lib/workspace-tab-commands'
import { closeClientHostedBrowserRow } from '@/runtime/client-hosted-browser-row-close'
import { useAppStore } from '@/store'
import { ActivityMachineChip } from '../activity-machines/ActivityMachineChip'
import { activateWorkspaceTab } from './activate-workspace-tab'
import { ActivityTabsNest } from './ActivityTabsNest'
import type { ActivityTabsVirtualItem } from './activity-tabs-rows'
import { RecentWorktreeRow } from './RecentWorktreeRow'
import type { WorkspaceTabItem } from './workspace-tab-items'

const icons = {
  terminal: Terminal,
  'agent-session': Terminal,
  browser: Globe,
  simulator: Smartphone,
  editor: File,
  diff: FileDiff,
  'conflict-review': FileDiff,
  'check-details': File
}

// The agent a tab runs, when the tab itself says: a chat's provider, or the agent Orca launched in a terminal.
function useTabAgent(tab: Tab): TerminalAgent | null {
  const launchAgent = useAppStore((s) =>
    tab.contentType === 'terminal'
      ? (s.tabsByWorktree[tab.worktreeId]?.find((t) => t.id === tab.entityId)?.launchAgent ?? null)
      : null
  )
  if (tab.contentType === 'agent-session') {
    return agentTypeToIconAgent(tab.agentSessionAgent)
  }
  return launchAgent
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Laid out like Activity's ActivityThreadRow card: the tab is the title, its workspace the footer.
export function WorkspaceTabRow({
  item,
  compactMode
}: {
  item: WorkspaceTabItem
  compactMode: boolean
}): React.JSX.Element {
  const { tab } = item
  const groupActiveTabId = useAppStore(
    (s) =>
      s.groupsByWorktree[tab.worktreeId]?.find((g) => g.id === tab.groupId)?.activeTabId ?? null
  )
  const activeClientRowId = useActiveClientHostedBrowserRowId({
    worktreeId: tab.worktreeId,
    groupId: tab.groupId,
    groupActiveTabId
  })
  const workspaceActive = useAppStore(
    (s) =>
      s.activeView === 'terminal' &&
      isPaletteCurrentWorktree(
        item.worktree,
        s.activeWorktreeId,
        s.activeWorkspaceExecutionHostId
      ) &&
      s.activeGroupIdByWorktree[tab.worktreeId] === tab.groupId
  )
  const rowActive = item.clientHostedRow
    ? activeClientRowId === tab.id
    : !activeClientRowId && groupActiveTabId === tab.id
  const active = workspaceActive && rowActive
  const Icon = icons[tab.contentType]
  const agent = useTabAgent(tab)
  const workspaceLabel = getActivityThreadWorkspaceTitle(item.worktree)
  const close = () => {
    if (item.clientHostedRow) {
      void closeClientHostedBrowserRow({ worktreeId: tab.worktreeId, browserPageId: tab.id }).catch(
        (error: unknown) => toast.error(errorText(error))
      )
      return
    }
    dispatchWorkspaceTabCommand({
      type: 'close',
      target: { kind: 'tab', worktreeId: tab.worktreeId, tabId: tab.id }
    })
  }
  const activate = () => {
    if (!activateWorkspaceTab(item)) {
      toast.error('This tab is no longer available.')
    }
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-current={active ? 'true' : undefined}
          data-worktree-card-surface="true"
          data-worktree-card-active={active ? 'primary' : undefined}
          data-activity-workspace-tab={item.key}
          onClick={activate}
          role="listitem"
          aria-label={item.label}
          aria-current={active ? 'true' : undefined}
          className="group relative flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none worktree-sidebar-card-hover focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <span
              className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              title={agent ? formatAgentTypeLabel(agent) : undefined}
            >
              {agent ? <AgentIcon agent={agent} size={14} /> : <Icon className="size-3.5" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <button
                type="button"
                aria-label={item.label}
                onClick={(event) => {
                  event.stopPropagation()
                  activate()
                }}
                className={cn(
                  'block w-full min-w-0 cursor-pointer text-left text-[13px] font-medium leading-5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  compactMode ? 'truncate' : 'line-clamp-2 break-words',
                  tab.isPreview && 'italic'
                )}
              >
                {item.label}
              </button>
              <div className="flex min-w-0 items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                <ActivityMachineChip worktree={item.worktree} repo={item.repo} />
                <span className="min-w-0 flex-1 truncate" title={workspaceLabel}>
                  {workspaceLabel}
                </span>
                {tab.isPinned ? <Pin className="size-2.5 shrink-0" aria-label="Pinned" /> : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        close()
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      aria-label={`Close ${item.label}`}
                      className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity hover:bg-accent/80 hover:text-foreground can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <X className="size-2.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Close tab</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {item.clientHostedRow ? null : (
          <ContextMenuItem
            onSelect={() => {
              const state = useAppStore.getState()
              if (tab.isPinned) {
                state.unpinTab(tab.id)
              } else {
                state.pinTab(tab.id)
              }
            }}
          >
            {tab.isPinned ? 'Unpin tab' : 'Pin tab'}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={close}>Close tab</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// pilot-hook: activity-tabs-row. A Pilot row in Activity's list, spaced like a thread row.
export function ActivityTabsVirtualRow({
  item,
  compactMode
}: {
  item: ActivityTabsVirtualItem
  compactMode: boolean
}): React.JSX.Element {
  const { row } = item
  return (
    <div className="pb-0.5">
      <ActivityTabsNest groupKey={item.groupKey}>
        {row.kind === 'tab' ? (
          <WorkspaceTabRow item={row.tab} compactMode={compactMode} />
        ) : (
          <RecentWorktreeRow item={row.recent} />
        )}
      </ActivityTabsNest>
    </div>
  )
}
