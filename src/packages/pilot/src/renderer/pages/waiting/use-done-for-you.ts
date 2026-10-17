import { useCallback } from 'react'
import type { ListedRun } from '../../../shared/api-types-runs'
import type { DoneRun } from '../../../shared/visibility-types'
import { useHeldMerge } from '../../hosts/held-merge'
import { useHostPoll, type HostRead } from '../../hosts/host-poll'
import { hostRpc } from '../../hosts/host-rpc'
import { mergedError, mergeDoneForYou } from '../../hosts/merge-inbox'
import { groupByHost, type Hosted, type PilotHostRef } from '../../hosts/pilot-host'
import { currentPilotHosts } from '../../hosts/pilot-hosts-feed'
import { errorText } from '../format'

type MachineRun = { id: string; host: PilotHostRef }

export const DONE_POLL_MS = 10_000

// Done for you (Run visibility spec §3): every machine's finished runs for the person that changed something, read
// every 10 s; Got it acknowledges them on each one's machine and reads the list again.
export function useDoneForYou(person: string | null): {
  runs: (DoneRun & { run: Hosted<ListedRun> })[]
  reads: readonly HostRead<unknown>[]
  error: string | null
  acknowledge: (runs: readonly MachineRun[]) => Promise<string | null>
} {
  const { reads, reload } = useHostPoll<unknown>(
    'pilot.runs.doneForYou',
    person ? { person } : {},
    DONE_POLL_MS
  )
  const runs = useHeldMerge(reads, mergeDoneForYou) ?? []
  const error = mergedError(reads)
  // Run ids are per machine: each machine acknowledges only its own, and one failing never stops the rest. A
  // failure names its machine once more than one is listed.
  const acknowledge = useCallback(
    async (picked: readonly MachineRun[]): Promise<string | null> => {
      const machines = groupByHost(picked)
      const settled = await Promise.allSettled(
        machines.map(({ host, items }) =>
          hostRpc(host, 'pilot.runs.acknowledge', { runIds: items.map((r) => r.id) })
        )
      )
      await reload()
      const failures = settled.flatMap((s, i) =>
        s.status === 'rejected' ? [{ host: machines[i].host, text: errorText(s.reason) }] : []
      )
      if (failures.length === 0) {
        return null
      }
      if (currentPilotHosts().length <= 1) {
        return failures[0].text
      }
      return failures.map((f) => `${f.host.machineName}: ${f.text}`).join(' · ')
    },
    [reload]
  )
  return { runs, reads, error, acknowledge }
}
