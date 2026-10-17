import { useCallback, useEffect, useRef, useState } from 'react'
import type { DoneRun } from '../../../shared/visibility-types'
import { pilotRpc } from '../../api'
import { errorText } from '../format'
import { isDoneRun } from '../../hosts/merge-inbox'

export const DONE_POLL_MS = 10_000

// Done for you (Run visibility spec §3): the person's finished runs that changed something, read every 10 s; Got it
// acknowledges them and reads the list again.
export function useDoneForYou(person: string | null): {
  runs: DoneRun[]
  error: string | null
  acknowledge: (runIds: string[]) => Promise<string | null>
} {
  const [runs, setRuns] = useState<DoneRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  // Each read's number: only the newest read's answer is shown, so a slow older poll can't undo a newer one.
  const latest = useRef(0)
  const reload = useCallback(async () => {
    latest.current += 1
    const asked = latest.current
    const current = (): boolean => mounted.current && asked === latest.current
    try {
      const got = await pilotRpc<unknown>('pilot.runs.doneForYou', person ? { person } : {})
      if (current()) {
        setRuns(Array.isArray(got) ? got.filter(isDoneRun) : [])
        setError(null)
      }
    } catch (e) {
      if (current()) {
        setError(errorText(e))
      }
    }
  }, [person])
  useEffect(() => {
    mounted.current = true
    void reload()
    const timer = setInterval(() => void reload(), DONE_POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [reload])
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
  return { runs, error, acknowledge }
}
