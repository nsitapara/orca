import { sameMachine } from '../../shared/machine-match'
import type { MergedAutomation } from './merge-automations'
import type { PilotHostEntry } from './pilot-host'

// Where a pinned job runs, and whether that machine is out of reach from this window.
export function runsOnLine(
  row: Pick<MergedAutomation, 'runsOn'>,
  hosts: readonly PilotHostEntry[]
): { text: string; warn: boolean } | null {
  const name = row.runsOn?.trim()
  if (!name) {
    return null
  }
  // Alone, this machine isn't probed, so its own name is unknown and nothing can be checked.
  if (hosts.length <= 1) {
    return { text: `Runs on ${name}`, warn: false }
  }
  const named = hosts.filter((host) => sameMachine(host.machineName, name))
  const online = named.find((host) => host.state === 'online')
  if (online) {
    return { text: `Runs on ${online.machineName}`, warn: false }
  }
  if (named.length > 0) {
    return { text: `Runs on ${named[0].machineName} · can't be reached`, warn: true }
  }
  return { text: `Runs on ${name} · no connected Pilot has that name`, warn: true }
}
