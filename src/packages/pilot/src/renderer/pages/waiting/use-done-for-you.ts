import { useCallback } from 'react'
import type { ListedRun } from '../../../shared/api-types-runs'
import type { DoneRun } from '../../../shared/visibility-types'
import { pilotRpc } from '../../api'
import { useHeldMerge } from '../../hosts/held-merge'
import { useHostPoll, type HostRead } from '../../hosts/host-poll'
import { mergedError, mergeDoneForYou } from '../../hosts/merge-inbox'
import type { Hosted } from '../../hosts/pilot-host'
import { errorText } from '../format'

export const DONE_POLL_MS = 10_000

// Done for you (Run visibility spec §3): every machine's finished runs for the person that changed something, read
// every 10 s; Got it acknowledges them and reads the list again.
export function useDoneForYou(person: string | null): {
  runs: (DoneRun & { run: Hosted<ListedRun> })[]
  reads: readonly HostRead<unknown>[]
  error: string | null
  acknowledge: (runIds: string[]) => Promise<string | null>
} {
  const { reads, reload } = useHostPoll<unknown>(
    'pilot.runs.doneForYou',
    person ? { person } : {},
    DONE_POLL_MS
  )
  const runs = useHeldMerge(reads, mergeDoneForYou) ?? []
  const error = mergedError(reads)
  const acknowledge = useCallback(
    async (runIds: string[]): Promise<string | null> => {
      try {
        await pilotRpc('pilot.runs.acknowledge', { runIds })
        await reload()
        return null
      } catch (e) {
        await reload()
        return errorText(e)
      }
    },
    [reload]
  )
  return { runs, reads, error, acknowledge }
}
