import type { ReactNode } from 'react'
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { SidebarBodyChoice } from '../sidebar/SidebarBodyChoice'
import { pilotStore } from '../store'
import {
  setActivityHideAutomationRuns,
  setActivityHideTerminals,
  setActivityShowAllTabs,
  setActivityShowRecentWorktrees,
  useActivityHideAutomationRuns,
  useActivityHideTerminals,
  useActivityShowAllTabs,
  useActivityShowRecentWorktrees
} from './activity-tabs-setting'

// pilot-hook: activity-tabs-menu. Pilot's rows in Activity's thread list View options, led by the switch
// back to Projects.
export function ActivityTabsMenuItems(): React.JSX.Element | null {
  const allTabs = useActivityShowAllTabs()
  const recentWorktrees = useActivityShowRecentWorktrees()
  if (!pilotStore()) {
    return null
  }
  return (
    <>
      <SidebarBodyChoice />
      <DropdownMenuCheckboxItem checked={allTabs} onCheckedChange={setActivityShowAllTabs}>
        Show all tabs in Activity
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={recentWorktrees}
        onCheckedChange={setActivityShowRecentWorktrees}
      >
        Show recently active worktrees
      </DropdownMenuCheckboxItem>
    </>
  )
}

// Only "Show all tabs" lists terminals, so only then is there one to hide.
function useHideTerminalsOffered(): boolean {
  return useActivityShowAllTabs() && pilotStore() !== null
}

// pilot-hook: activity-tabs-filter-menu. "Hide terminals" and "Hide automation runs" in the Filters section, beside
// upstream's.
export function ActivityTabsFilterMenuItems(): React.JSX.Element | null {
  const terminalsOffered = useHideTerminalsOffered()
  const hideTerminals = useActivityHideTerminals()
  const hideAutomationRuns = useActivityHideAutomationRuns()
  if (!pilotStore()) {
    return null
  }
  return (
    <>
      {terminalsOffered && (
        <DropdownMenuCheckboxItem
          checked={hideTerminals}
          onCheckedChange={(checked) => setActivityHideTerminals(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          Hide terminals
        </DropdownMenuCheckboxItem>
      )}
      <DropdownMenuCheckboxItem
        checked={hideAutomationRuns}
        onCheckedChange={(checked) => setActivityHideAutomationRuns(checked === true)}
        onSelect={(event) => event.preventDefault()}
      >
        Hide automation runs
      </DropdownMenuCheckboxItem>
    </>
  )
}

// pilot-hook: activity-tabs-filter-count. Pilot's filters count toward the options badge while they apply.
export function useActivityTabsFilterCount(): number {
  const terminalsOffered = useHideTerminalsOffered()
  const hideTerminals = useActivityHideTerminals()
  const hideAutomationRuns = useActivityHideAutomationRuns()
  if (!pilotStore()) {
    return 0
  }
  return (terminalsOffered && hideTerminals ? 1 : 0) + (hideAutomationRuns ? 1 : 0)
}

// pilot-hook: activity-tabs-compact-option. Pilot's Activity rows are always one line, so upstream's
// "Compact mode" would change nothing; it shows only while Pilot isn't attached.
export function ActivityTabsCompactModeItem({ children }: { children: ReactNode }): ReactNode {
  return pilotStore() ? null : children
}
