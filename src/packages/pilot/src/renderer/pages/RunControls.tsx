import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TickOutcome } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { errorText, outcomeLine } from './format'

export const LONG_CALL_MS = 180_000
type Phase = 'idle' | 'confirm' | 'running'

// Dry run is safe; Run now starts real agents, so it takes an explicit inline Confirm.
export function RunControls({ id, onDone }: { id: string; onDone: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = async (
    method: 'pilot.automations.dryRun' | 'pilot.automations.tickNow'
  ): Promise<void> => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setPhase('running')
    setMessage(null)
    try {
      const result = await pilotRpc<TickOutcome>(method, { id }, { timeoutMs: LONG_CALL_MS })
      if (mounted.current) {
        setMessage(outcomeLine(result, id))
      }
    } catch (e) {
      if (mounted.current) {
        setMessage(errorText(e))
      }
    }
    inFlight.current = false
    if (!mounted.current) {
      return
    }
    setPhase('idle')
    onDone()
  }

  const busy = phase === 'running'
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {phase === 'confirm' ? (
          <>
            <span className="text-sm">Start agents for items that pass the checks?</span>
            <Button size="sm" onClick={() => void run('pilot.automations.tickNow')}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase('idle')}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {busy ? <span className="text-sm text-muted-foreground">Running…</span> : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run('pilot.automations.dryRun')}
            >
              Dry run
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setPhase('confirm')}
            >
              Run now
            </Button>
          </>
        )}
      </div>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  )
}
