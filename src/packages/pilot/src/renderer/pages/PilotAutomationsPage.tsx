import { useEffect, useState } from 'react'
import type { PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'

export default function PilotAutomationsPage(): React.JSX.Element {
  const [status, setStatus] = useState<PilotStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    pilotRpc<PilotStatus>('pilot.status').then(setStatus, (e: unknown) => setError(String(e)))
  }, [])
  return (
    <main className="relative flex h-full flex-col bg-background px-5 pt-6">
      <h1 className="text-base font-semibold leading-8">Automations</h1>
      {error ? (
        <p className="text-sm text-destructive">{`Pilot isn't responding: ${error}`}</p>
      ) : null}
      {status ? (
        <div className="mt-2 text-sm text-muted-foreground">
          <p>
            Pilot {status.version} · {status.process}
          </p>
          <p>Automation folders: {status.automationDirs.join(', ')}</p>
          {status.missingDirs.length ? <p>Missing: {status.missingDirs.join(', ')}</p> : null}
        </div>
      ) : null}
    </main>
  )
}
