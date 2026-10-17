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

// Each machine once, in the order given: a job's stages can share one.
export function MachineChips({
  hosts
}: {
  hosts: readonly PilotHostRef[]
}): React.JSX.Element | null {
  const shown = useMachineChipsShown()
  if (!shown) {
    return null
  }
  const unique = [...new Map(hosts.map((host) => [host.key, host])).values()]
  return (
    <>
      {unique.map((host) => (
        <WorktreeHostContextBadge key={host.key} label={host.machineName} className="shrink-0" />
      ))}
    </>
  )
}
