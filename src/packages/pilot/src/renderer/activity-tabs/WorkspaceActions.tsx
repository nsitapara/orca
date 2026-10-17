import { useEffect, useRef, type RefObject } from 'react'
import {
  Bot,
  FilePlus,
  Globe,
  Plus,
  Smartphone,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Terminal,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { QuickLaunchAgentMenuItems } from '@/components/tab-bar/QuickLaunchButton'
import { TabBarQuickCommandsButton } from '@/components/tab-bar/TabBarQuickCommandsButton'
import { useTabGroupWorkspaceModel } from '@/components/tab-group/useTabGroupWorkspaceModel'
import { getClientCreationActionPolicy } from '@/lib/client-creation-action-policy'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { useAppStore } from '@/store'

const FIRST_ITEM = '[role="menuitem"]:not([data-disabled])'

function showError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

// Agents can be detected after the menu opens: until the user moves focus, keep it on the first
// enabled item, which becomes the first agent once agents render above the settings item.
function FocusFirstItem({
  menuRef,
  autoFocused
}: {
  menuRef: RefObject<HTMLDivElement | null>
  autoFocused: RefObject<HTMLElement | null>
}): null {
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }
    const observer = new MutationObserver(() => {
      const first = menu.querySelector<HTMLElement>(FIRST_ITEM)
      const focused = document.activeElement
      if (first && first !== focused && (focused === menu || focused === autoFocused.current)) {
        autoFocused.current = first
        first.focus()
      }
    })
    observer.observe(menu, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [menuRef, autoFocused])
  return null
}

function WorkspaceActionsBar({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  const { commands } = useTabGroupWorkspaceModel({ worktreeId, groupId })
  const pendingFocus = useRef<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const autoFocused = useRef<HTMLElement | null>(null)
  const label = useAppStore(
    (s) =>
      s.getKnownWorktreeById(worktreeId, s.activeWorkspaceExecutionHostId ?? undefined)?.displayName
  )
  const hasSplitGroups = useAppStore((s) => (s.groupsByWorktree[worktreeId]?.length ?? 0) > 1)
  const canCreateBrowser = useAppStore(
    (s) => getClientCreationActionPolicy(s, worktreeId)['managed-browser'].state === 'enabled'
  )
  const canCreateSimulator = useAppStore(
    (s) =>
      s.settings?.mobileEmulatorEnabled !== false &&
      getClientCreationActionPolicy(s, worktreeId)['mobile-emulator'].state === 'enabled'
  )
  const create = (kind: 'terminal' | 'browser' | 'file') => {
    const state = useAppStore.getState()
    let action: Promise<unknown>
    if (kind === 'browser') {
      action = state.openNewBrowserTabInActiveWorkspace(groupId)
    } else if (kind === 'file') {
      action = state.openNewMarkdownInActiveWorkspace(groupId)
    } else {
      action = state.openNewTerminalTabInActiveWorkspace(groupId)
    }
    void action.catch(showError)
  }
  const split = (direction: 'right' | 'down') => {
    const state = useAppStore.getState()
    const splitGroupId = state.createEmptySplitGroup(worktreeId, groupId, direction)
    if (!splitGroupId) {
      return
    }
    // Why the active-workspace path: it routes the new terminal to a paired or SSH host.
    void state.openNewTerminalTabInActiveWorkspace(splitGroupId).catch(showError)
  }
  return (
    <div className="shrink-0 space-y-1 border-b border-border px-2 py-1.5">
      <div className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Bot />
              New agent
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            ref={menuRef}
            side="right"
            align="start"
            onFocusCapture={(event) => {
              const first = menuRef.current?.querySelector<HTMLElement>(FIRST_ITEM)
              if (event.target === menuRef.current && first) {
                autoFocused.current = first
                first.focus()
              }
            }}
            onCloseAutoFocus={(event) => {
              if (!pendingFocus.current) {
                return
              }
              event.preventDefault()
              const tabId = pendingFocus.current
              pendingFocus.current = null
              requestAnimationFrame(() =>
                requestAnimationFrame(() => focusTerminalTabSurface(tabId))
              )
            }}
          >
            <FocusFirstItem menuRef={menuRef} autoFocused={autoFocused} />
            <QuickLaunchAgentMenuItems
              worktreeId={worktreeId}
              groupId={groupId}
              onFocusTerminal={(tabId) => {
                pendingFocus.current = tabId
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New tab">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onSelect={() => create('terminal')}>
              <Terminal />
              New terminal
            </DropdownMenuItem>
            {canCreateBrowser ? (
              <DropdownMenuItem onSelect={() => create('browser')}>
                <Globe />
                New browser
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => create('file')}>
              <FilePlus />
              New Markdown file
            </DropdownMenuItem>
            {canCreateSimulator && commands.newSimulatorTab ? (
              <DropdownMenuItem onSelect={commands.newSimulatorTab}>
                <Smartphone />
                Mobile Emulator
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => split('right')}>
              <SquareSplitHorizontal />
              Split right
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => split('down')}>
              <SquareSplitVertical />
              Split down
            </DropdownMenuItem>
            {hasSplitGroups ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => commands.closeGroup()}>
                  <X />
                  Close split pane
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <TabBarQuickCommandsButton worktreeId={worktreeId} groupId={groupId} />
      </div>
    </div>
  )
}

export function WorkspaceActions(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const groupId = useAppStore((s) =>
    worktreeId
      ? (s.activeGroupIdByWorktree[worktreeId] ?? s.groupsByWorktree[worktreeId]?.[0]?.id)
      : undefined
  )
  if (!worktreeId || !groupId) {
    return null
  }
  return (
    <WorkspaceActionsBar
      key={`${worktreeId}:${groupId}`}
      worktreeId={worktreeId}
      groupId={groupId}
    />
  )
}
