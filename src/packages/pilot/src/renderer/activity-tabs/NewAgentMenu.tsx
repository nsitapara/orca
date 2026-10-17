import { useEffect, useRef, type RefObject } from 'react'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { QuickLaunchAgentMenuItems } from '@/components/tab-bar/QuickLaunchButton'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { useAppStore } from '@/store'

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

/** The tab bar's agent picker for one worktree, which may have no tab group yet. */
export function NewAgentMenu({ worktreeId }: { worktreeId: string }): React.JSX.Element {
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
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" onClick={(event) => event.stopPropagation()}>
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
          requestAnimationFrame(() => requestAnimationFrame(() => focusTerminalTabSurface(tabId)))
        }}
      >
        <FocusFirstItem menuRef={menuRef} autoFocused={autoFocused} />
        {groupId ? (
          <QuickLaunchAgentMenuItems
            worktreeId={worktreeId}
            groupId={groupId}
            onFocusTerminal={(tabId) => {
              pendingFocus.current = tabId
            }}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
