import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationListPayload, PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { AutomationsTable } from './AutomationsTable'
import { setPilotAutomationsView } from './automations-view'
import { errorText } from './format'
import { ProblemNotices } from './ProblemNotices'

// The Automations page's list: Pilot's YAML automations.
export function PilotAutomationsSection({
  onOpen,
  onOpenJob
}: {
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  const [payload, setPayload] = useState<AutomationListPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)
  const load = useCallback(() => {
    pilotRpc<AutomationListPayload>('pilot.automations.list').then(
      (p) => {
        if (!mounted.current) {
          return
        }
        setPayload(p)
        setNow(Date.now())
        setError(null)
        setStartError(null)
      },
      (e: unknown) => {
        if (!mounted.current) {
          return
        }
        setError(errorText(e))
        // The list fails in degraded mode; pilot.status still says why Pilot didn't start.
        pilotRpc<PilotStatus>('pilot.status').then(
          (s) => mounted.current && setStartError(s.error),
          () => mounted.current && setStartError(null)
        )
      }
    )
  }, [])
  useEffect(() => {
    mounted.current = true
    load()
    const timer = setInterval(load, 20_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load])

  const loading = !payload && !error
  return (
    <section className="flex flex-col gap-3 px-5 pb-6 pt-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-sm font-semibold leading-6">Automations</h2>
          <p className="text-xs text-muted-foreground">
            Each automation is a YAML file in an automation folder.
          </p>
        </div>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setPilotAutomationsView('activity')}
        >
          Activity
        </button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ProblemNotices payload={payload} startError={startError} />
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {payload ? (
        <AutomationsTable payload={payload} now={now} onOpen={onOpen} onOpenJob={onOpenJob} />
      ) : null}
    </section>
  )
}
