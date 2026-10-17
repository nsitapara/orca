import { useState } from 'react'
import { StepForward } from 'lucide-react'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { ContinueRunResult, RunRow } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { errorText } from '../pages/format'

const BROKEN: ReadonlySet<RunRow['status']> = new Set(['failed', 'timed_out', 'cancelled'])

// A run that broke goes on from where it stopped (main/run/run-continue.ts); an answer run's card is answered again
// instead. Only the desktop may continue one (methods-runs.ts), so the browser version offers nothing.
export function canContinue(run: Pick<RunRow, 'status' | 'trigger'>): boolean {
  return !isWebClientLocation() && BROKEN.has(run.status) && run.trigger !== 'answer'
}

function continuedNote(result: ContinueRunResult): string {
  const how = result.resumed ? 'in its own session' : 'started over'
  return `Continuing from step ${result.step}, ${how}`
}

// Continue run: the steps that finished keep their results, the step that broke goes again (resuming its agent's
// session when it can), and the run goes on from there. Pilot's reason shows when it won't.
export function ContinueRun({
  run
}: {
  run: Pick<RunRow, 'id' | 'status' | 'trigger'>
}): React.JSX.Element | null {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!canContinue(run) && note === null) {
    return null
  }
  const go = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await pilotRpc<ContinueRunResult>('pilot.runs.continue', { runId: run.id })
      setNote(continuedNote(result))
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      {canContinue(run) ? (
        <button
          type="button"
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 underline"
          onClick={() => void go()}
        >
          <StepForward size={12} />
          {busy ? 'Continuing…' : 'Continue run'}
        </button>
      ) : null}
      {note ? <span className="min-w-0 text-muted-foreground">{note}</span> : null}
    </span>
  )
}
