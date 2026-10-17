import type React from 'react'
import { ActivityThreadListPane } from '@/components/activity/activity-thread-list-pane'
import { ActivityMachineChipsContext } from './activity-machine-chips-context'
import { useActivityMachineChips } from './use-activity-machine-chips'

// pilot-hook: activity-machines-list and activity-machines-page. Upstream's pane, under one
// decision of whether its rows span machines, so every row's chip agrees.
export function ActivityMachinesListPane(
  props: React.ComponentProps<typeof ActivityThreadListPane>
): React.JSX.Element {
  const chips = useActivityMachineChips(props.visibleThreadGroups)
  return (
    <ActivityMachineChipsContext.Provider value={chips}>
      <ActivityThreadListPane {...props} />
    </ActivityMachineChipsContext.Provider>
  )
}
