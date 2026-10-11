import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationListPayload, PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { AutomationView } from './AutomationView'
import { AutomationsTable } from './AutomationsTable'
import { errorText } from './format'
import { ProblemNotices } from './ProblemNotices'

export function PilotAutomationsTab(): React.JSX.Element {
  const [payload, setPayload] = useState<AutomationListPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
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

  if (open) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <AutomationView id={open} onBack={() => setOpen(null)} />
      </main>
    )
  }
  const loading = !payload && !error
  return (
    <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
      <h1 className="text-base font-semibold leading-8">Automations</h1>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ProblemNotices payload={payload} startError={startError} />
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {payload ? <AutomationsTable payload={payload} now={now} onOpen={setOpen} /> : null}
    </main>
  )
}
