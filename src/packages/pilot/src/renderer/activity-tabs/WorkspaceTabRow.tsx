import { File, FileDiff, Globe, Pin, Smartphone, Terminal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActiveClientHostedBrowserRowId } from '@/lib/pane-manager/client-hosted-browser-row-state'
import { isPaletteCurrentWorktree } from '@/lib/palette-repo-resolution'
import { cn } from '@/lib/utils'
import { dispatchWorkspaceTabCommand } from '@/lib/workspace-tab-commands'
import { closeClientHostedBrowserRow } from '@/runtime/client-hosted-browser-row-close'
import { useAppStore } from '@/store'
import { activateWorkspaceTab } from './activate-workspace-tab'
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function WorkspaceTabRow({ item }: { item: WorkspaceTabItem }): React.JSX.Element {
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
          className={cn(
            'group flex items-center gap-1 rounded-md text-sidebar-foreground hover:bg-sidebar-accent',
            active && 'bg-sidebar-accent'
          )}
          data-current={active}
          data-activity-workspace-tab={item.key}
        >
          <button
            type="button"
            onClick={activate}
            aria-current={active ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Icon className="size-3.5 shrink-0" />
            <span className={cn('truncate', tab.isPreview && 'italic')}>{item.label}</span>
            {tab.isPinned ? <Pin className="size-3 shrink-0" /> : null}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={close}
                aria-label={`Close ${item.label}`}
              >
                <X className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close tab</TooltipContent>
          </Tooltip>
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
