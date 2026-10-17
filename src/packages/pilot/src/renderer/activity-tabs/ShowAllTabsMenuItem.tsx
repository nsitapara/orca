import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { pilotStore } from '../store'
import { setActivityShowAllTabs, useActivityShowAllTabs } from './activity-tabs-setting'

// pilot-hook: activity-tabs-menu. The toggle in Activity's thread list options.
export function ShowAllTabsMenuItem(): React.JSX.Element | null {
  const on = useActivityShowAllTabs()
  if (!pilotStore()) {
    return null
  }
  return (
    <DropdownMenuCheckboxItem checked={on} onCheckedChange={setActivityShowAllTabs}>
      Show all tabs in Activity
    </DropdownMenuCheckboxItem>
  )
}
