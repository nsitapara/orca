import React from 'react'
import { WorktreeHostContextBadge } from '@/components/sidebar/WorktreeHostContextBadge'
import type { PilotHostRef } from './pilot-host'
import { useMachineChipsShown } from './pilot-hosts-feed'

export function MachineChip({ host }: { host: PilotHostRef }): React.JSX.Element | null {
  const shown = useMachineChipsShown()
  if (!shown) {
    return null
  }
  return <WorktreeHostContextBadge label={host.machineName} />
}
