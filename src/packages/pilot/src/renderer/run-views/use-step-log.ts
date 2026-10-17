import { useEffect, useState } from 'react'
import type { StepLog } from '../../shared/visibility-types'
import { hostRpc } from '../hosts/host-rpc'
import { usePilotHost } from '../hosts/PilotHostContext'
import { errorText } from '../pages/format'

export const STEP_LOG_POLL_MS = 5_000

function isStepLog(value: unknown): value is StepLog {
  return Boolean(value) && Array.isArray((value as StepLog).entries)
}

// A step's log (pilot.runs.log): read when its row opens, and every 5 s while the step runs, from the run's machine.
export function useStepLog(
  runId: string,
  stepIdx: number,
  live: boolean
): { log: StepLog | null; error: string | null } {
  const host = usePilotHost()
  const [log, setLog] = useState<StepLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      Promise.resolve(hostRpc<StepLog>(host, 'pilot.runs.log', { runId, stepIdx })).then(
        (got) => {
          if (alive) {
            if (isStepLog(got)) {
              setLog(got)
            }
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
    if (!live) {
      return () => {
        alive = false
      }
    }
    const timer = setInterval(load, STEP_LOG_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [runId, stepIdx, live, host])
  return { log, error }
}
