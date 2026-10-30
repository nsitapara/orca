import React from 'react'
import { Search } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { SetupGuideSidebarEntry } from '@/components/sidebar/SetupGuideSidebarEntry'
import { SidebarHeaderActions } from '@/components/sidebar/sidebar-header-actions'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'
import { PagesMenu } from './PagesMenu'
import { PinnedPagesNav } from './PinnedPagesNav'
import { CurrentBand } from './CurrentBand'

const AgentDashboardSidebarEntry = lazyWithRetry(
  () => import('@/components/sidebar/AgentDashboardSidebarEntry')
)

// Upstream's search row (SidebarNav), at the width the top row leaves it.
function SearchButton(): React.JSX.Element {
  const combos = useShortcutKeyComboDetails('worktree.palette')
  const openModal = useAppStore((s) => s.openModal)
  return (
    <button
      type="button"
      onClick={() => openModal('worktree-palette')}
      aria-label="Search worktrees and browser tabs"
      className="group flex min-w-0 flex-1 items-center gap-2 rounded-md bg-worktree-sidebar-foreground/5 px-2 py-1 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
    >
      <Search className="size-4 shrink-0 text-worktree-sidebar-foreground/30" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">Search</span>
      <span className="pointer-events-none hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
        {combos.map((combo) => (
          <ShortcutKeyCombo
            key={combo.keys.join('-')}
            keys={combo.keys}
            doubleTap={combo.doubleTap}
            className="inline-flex gap-0.5"
            keyCapClassName="min-w-4 border-worktree-sidebar-border/80 bg-worktree-sidebar-foreground/8 px-1 py-px text-[9px] text-worktree-sidebar-foreground/55 shadow-none"
            separatorClassName="text-[9px] text-worktree-sidebar-foreground/45"
          />
        ))}
      </span>
    </button>
  )
}

type SidebarTopProps = {
  // Where the Activity list portals its options menu (SidebarHeader's slot, upstream).
  activityOptionsTarget: React.Ref<HTMLDivElement>
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  // Upstream's SidebarNav and SidebarHeader, kept while Pilot isn't attached.
  children: React.ReactNode
}

/**
 * pilot-hook: sidebar-top. The sidebar's top in one place: a row of ☰ (open or pin a page), Search,
 * the view's options menu and the new project and workspace buttons; the pinned pages as rows (and
 * the open page while it's open); then the Current header. The Projects title and its bell are gone:
 * the options menus' View sections switch Projects and Activity.
 */
export function SidebarTop({
  activityOptionsTarget,
  onWorkspaceBoardMenuOpenChange,
  children
}: SidebarTopProps): React.ReactNode {
  const agentsViewActive = useAppStore((s) => s.sidebarBody === 'agents')
  const showAgentDashboard = useAppStore(
    (s) => s.settings?.experimentalAgentDashboardPopout === true
  )
  if (!pilotStore()) {
    return children
  }
  return (
    <>
      <div
        className="flex flex-col gap-0.5 px-2 pt-2 pb-1"
        data-contextual-tour-target="sidebar-navigation"
      >
        <div className="mb-0.5 flex min-w-0 items-center gap-1">
          <PagesMenu />
          <SearchButton />
          {agentsViewActive ? (
            <div ref={activityOptionsTarget} className="flex shrink-0 items-center" />
          ) : null}
          <SidebarHeaderActions
            onWorkspaceBoardMenuOpenChange={onWorkspaceBoardMenuOpenChange}
            agentsViewActive={agentsViewActive}
          />
        </div>
        <SetupGuideSidebarEntry />
        <PinnedPagesNav />
        {showAgentDashboard ? (
          <React.Suspense fallback={null}>
            <AgentDashboardSidebarEntry />
          </React.Suspense>
        ) : null}
      </div>
      <CurrentBand />
    </>
  )
}
