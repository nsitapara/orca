import { useEffect, useState } from 'react'
import type { StepLog } from '../../shared/visibility-types'
import { pilotRpc } from '../api'
import { errorText } from '../pages/format'

export const STEP_LOG_POLL_MS = 5_000

function isStepLog(value: unknown): value is StepLog {
  return Boolean(value) && Array.isArray((value as StepLog).entries)
}

// A step's log (pilot.runs.log): read when its row opens, and every 5 s while the step runs.
export function useStepLog(
  runId: string,
  stepIdx: number,
  live: boolean
): { log: StepLog | null; error: string | null } {
  const [log, setLog] = useState<StepLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      pilotRpc<StepLog>('pilot.runs.log', { runId, stepIdx }).then(
        (got) => {
          if (alive) {
            setLog(isStepLog(got) ? got : null)
            setError(null)
          }
        },
        (e: unknown) => {
          if (alive) {
            setError(errorText(e))
          }
        }
      )
    }
    load()
    const timer = live ? setInterval(load, STEP_LOG_POLL_MS) : null
    return () => {
      alive = false
      if (timer) {
        clearInterval(timer)
      }
    }
  }, [runId, stepIdx, live])
  return { log, error }
}
