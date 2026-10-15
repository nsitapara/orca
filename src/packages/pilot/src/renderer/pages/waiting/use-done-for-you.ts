import { useCallback, useEffect, useRef, useState } from 'react'
import type { DoneRun } from '../../../shared/visibility-types'
import { pilotRpc } from '../../api'
import { errorText } from '../format'

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
  const reload = useCallback(async () => {
    try {
      const got = await pilotRpc<DoneRun[]>('pilot.runs.doneForYou', person ? { person } : {})
      if (mounted.current) {
        setRuns(Array.isArray(got) ? got : [])
        setError(null)
      }
    } catch (e) {
      if (mounted.current) {
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
