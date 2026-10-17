import { pilotStore } from '../store'
import { useActivityShowAllTabs } from './activity-tabs-setting'
import { WorkspaceActions } from './WorkspaceActions'

// pilot-hook: activity-tabs-panel. The active workspace's New agent / new tab actions above
// Activity's list while "Show all tabs" is on; the tabs themselves are rows in that list.
export function ActivityTabsPanel(): React.JSX.Element | null {
  const on = useActivityShowAllTabs()
  if (!on || !pilotStore()) {
    return null
  }
  return <WorkspaceActions />
}
