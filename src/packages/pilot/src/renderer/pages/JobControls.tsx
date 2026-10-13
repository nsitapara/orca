import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TickOutcome } from '../../shared/api-types'
import { jobEnabled, type JobGroup } from '../../shared/job-stages'
import { pilotRpc } from '../api'
import { errorText, outcomeLine } from './format'
import { LONG_CALL_MS } from './RunControls'

type Phase = 'idle' | 'confirm' | 'running'

function stageName(n: number | undefined): string {
  return `Stage ${n ?? '?'}`
}

// Dry run each stage, in stage order. Dry runs only: nothing starts.
async function dryRunAll(job: JobGroup): Promise<string[]> {
  const lines: string[] = []
  for (const s of job.stages) {
    try {
      const result = await pilotRpc<TickOutcome>(
        'pilot.automations.dryRun',
        { id: s.id },
        { timeoutMs: LONG_CALL_MS }
      )
      lines.push(`${stageName(s.job?.stage)}: ${outcomeLine(result, s.id)}`)
    } catch (e) {
      lines.push(`${stageName(s.job?.stage)}: ${errorText(e)}`)
    }
  }
  return lines
}

// Each stage not yet in the wanted state, through the one-automation call, so Pilot applies the same caller rules
// (an agent in a run is refused). The first refusal stops the rest and is what the page says.
async function setAll(job: JobGroup, enabled: boolean): Promise<string[]> {
  for (const s of job.stages.filter((x) => x.enabled !== enabled)) {
    try {
      await pilotRpc('pilot.automations.setEnabled', { id: s.id, enabled })
    } catch (e) {
      return [`${stageName(s.job?.stage)}: ${errorText(e)}`]
    }
  }
  return []
}

// The job page's buttons. Turning the job on asks first, as Run now does: its stages then tick on their schedules.
export function JobControls({
  job,
  onDone
}: {
  job: JobGroup
  onDone: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<string[]>([])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const on = jobEnabled(job)

  const run = async (work: () => Promise<string[]>): Promise<void> => {
    setPhase('running')
    setLines([])
    const said = await work()
    if (!mounted.current) {
      return
    }
    setLines(said)
    setPhase('idle')
    onDone()
  }
  const toggle = (): void => {
    if (on) {
      void run(() => setAll(job, false))
      return
    }
    setPhase('confirm')
  }

  const busy = phase === 'running'
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {phase === 'confirm' ? (
          <>
            <span className="text-sm">{`Turn on all ${job.stages.length} stages? They tick on their schedules.`}</span>
            <Button size="sm" onClick={() => void run(() => setAll(job, true))}>
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
              onClick={() => void run(() => dryRunAll(job))}
            >
              Dry run all
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={toggle}>
              {on ? 'Turn off' : 'Turn on'}
            </Button>
          </>
        )}
      </div>
      {lines.map((line) => (
        <p key={line} className="text-sm text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  )
}
