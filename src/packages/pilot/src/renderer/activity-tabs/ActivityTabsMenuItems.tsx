import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { pilotStore } from '../store'
import {
  setActivityHideTerminals,
  setActivityShowAllTabs,
  setActivityShowRecentWorktrees,
  useActivityHideTerminals,
  useActivityShowAllTabs,
  useActivityShowRecentWorktrees
} from './activity-tabs-setting'

// pilot-hook: activity-tabs-menu. Pilot's toggles in Activity's thread list View options.
export function ActivityTabsMenuItems(): React.JSX.Element | null {
  const allTabs = useActivityShowAllTabs()
  const recentWorktrees = useActivityShowRecentWorktrees()
  if (!pilotStore()) {
    return null
  }
  return (
    <>
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

// pilot-hook: activity-tabs-filter-menu. "Hide terminals" in the Filters section, beside upstream's.
export function ActivityTabsFilterMenuItems(): React.JSX.Element | null {
  const offered = useHideTerminalsOffered()
  const hideTerminals = useActivityHideTerminals()
  if (!offered) {
    return null
  }
  return (
    <DropdownMenuCheckboxItem
      checked={hideTerminals}
      onCheckedChange={(checked) => setActivityHideTerminals(checked === true)}
      onSelect={(event) => event.preventDefault()}
    >
      Hide terminals
    </DropdownMenuCheckboxItem>
  )
}

// pilot-hook: activity-tabs-filter-count. "Hide terminals" counts toward the options badge while it applies.
export function useActivityTabsFilterCount(): number {
  const offered = useHideTerminalsOffered()
  const hideTerminals = useActivityHideTerminals()
  return offered && hideTerminals ? 1 : 0
}
