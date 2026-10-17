import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { pilotStore } from '../store'
import {
  setActivityShowAllTabs,
  setActivityShowRecentWorktrees,
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
