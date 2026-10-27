import { useEffect, useRef, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { QuickLaunchAgentMenuItems } from '@/components/tab-bar/QuickLaunchButton'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { useAppStore } from '@/store'
import { switchToWorkspaceForLaunch } from '../new-tab-agent-picker/launch-agent-in-workspace'

const FIRST_ITEM = '[role="menuitem"]:not([data-disabled])'

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

// Activity lists worktrees other than the open one, so the new tab's worktree comes into view with it.
function switchToWorktree(worktreeId: string): boolean {
  const worktree = useAppStore.getState().getKnownWorktreeById(worktreeId)
  const executionHostId = worktree ? getPaletteWorktreeExecutionHostId(worktree) : undefined
  return switchToWorkspaceForLaunch(worktreeId, executionHostId, { revealInSidebar: false })
}

/** The tab bar's agent picker for one worktree, which may have no tab group yet, behind a + button.
 *  `onPick` runs as a pick opens its tab. */
export function NewAgentMenu({
  worktreeId,
  onPick
}: {
  worktreeId: string
  onPick?: () => void
}): React.JSX.Element {
  const groupId = useAppStore(
    (s) => s.activeGroupIdByWorktree[worktreeId] ?? s.groupsByWorktree[worktreeId]?.[0]?.id ?? null
  )
  const pendingFocus = useRef<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const autoFocused = useRef<HTMLElement | null>(null)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // A worktree with no tabs has no group for the new tab to join yet.
        if (open && !groupId) {
          useAppStore.getState().ensureWorktreeRootGroup(worktreeId)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New agent"
              // The row or header around it opens or folds on click and Enter: this button only opens the menu.
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">New agent</TooltipContent>
      </Tooltip>
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
          requestAnimationFrame(() => requestAnimationFrame(() => focusTerminalTabSurface(tabId)))
        }}
      >
        <FocusFirstItem menuRef={menuRef} autoFocused={autoFocused} />
        {groupId ? (
          <QuickLaunchAgentMenuItems
            worktreeId={worktreeId}
            groupId={groupId}
            beforeSurfaceOpen={() => {
              onPick?.()
              return switchToWorktree(worktreeId)
            }}
            onFocusTerminal={(tabId) => {
              pendingFocus.current = tabId
            }}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
