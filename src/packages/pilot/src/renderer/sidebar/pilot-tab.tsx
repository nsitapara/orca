import { useLayoutEffect, type RefObject } from 'react'
import { CalendarClock } from 'lucide-react'
import type { ActivityBarItem } from '@/components/right-sidebar/activity-bar-buttons'
import { PILOT_TAB, resolveActivityClick } from '../../shared/sidebar-click'
import { pilotStore } from '../store'

export { PILOT_TAB, isPilotTab } from '../../shared/sidebar-click'

export const pilotActivityItems: ActivityBarItem[] = [
  {
    id: PILOT_TAB as ActivityBarItem['id'],
    icon: CalendarClock,
    title: 'Automations',
    shortcut: ''
  }
]

export function PilotRightSidebarPanel(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Automations
      </div>
      <p className="text-muted-foreground">
        This worktree&apos;s timeline (next, now and earlier runs) arrives in M2. For now, open
        Automations from the left navigation.
      </p>
    </div>
  )
}

// pilot-hook: right-sidebar-reclick. Returns true when it handled the click (closed the panel).
export function handlePilotActivityClick(tab: string, effectiveTab: string): boolean {
  const store = pilotStore()
  if (!store) {
    return false
  }
  const state = store.getState()
  const action = resolveActivityClick({ tab, effectiveTab, open: state.rightSidebarOpen })
  if (action === 'close') {
    state.setRightSidebarOpen(false)
    return true
  }
  if (action === 'open') {
    state.setRightSidebarOpen(true)
  }
  return false
}

// pilot-hook: right-sidebar-keep-strip. Orca collapses the whole sidebar container to width 0 when closed,
// which hides the side icon strip too. When the bar is on the side, keep the container as wide as the strip.
export function usePilotSideStripWhenClosed(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  sideWidth: number
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open || sideWidth <= 0) {
      return
    }
    el.style.width = `${sideWidth}px`
    el.style.minWidth = `${sideWidth}px`
  }, [ref, open, sideWidth])
}
