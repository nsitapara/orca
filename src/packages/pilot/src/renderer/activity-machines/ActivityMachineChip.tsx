import type React from 'react'
import { useContext } from 'react'
import { WorktreeHostContextBadge } from '@/components/sidebar/WorktreeHostContextBadge'
import { ActivityMachineChipsContext } from './activity-machine-chips-context'
import { getActivityRowHostId, type ActivityMachineRow } from './activity-machine-labels'

// Renders nothing outside a list that spans machines, so rows keep their layout on one machine.
export function ActivityMachineChip(props: ActivityMachineRow): React.JSX.Element | null {
  const chips = useContext(ActivityMachineChipsContext)
  if (!chips) {
    return null
  }
  const label = chips.labels.get(getActivityRowHostId(props, chips.defaultHostId))
  return label ? <WorktreeHostContextBadge label={label} /> : null
}
