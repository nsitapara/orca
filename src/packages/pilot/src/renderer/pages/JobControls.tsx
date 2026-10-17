import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AutomationSummary, TickOutcome } from '../../shared/api-types'
import type { JobGroup } from '../../shared/job-stages'
import { hostRpc } from '../hosts/host-rpc'
import type { Hosted } from '../hosts/pilot-host'
import { stagesText } from './AutomationsTable'
import { errorText } from './format'
import { LONG_CALL_MS } from './RunControls'

type Phase = 'idle' | 'confirm' | 'running'
// Each stage carries its home machine, where its own buttons' calls go.
type HostedJob = JobGroup<Hosted<AutomationSummary>>

function stageName(n: number | undefined): string {
  return `Stage ${n ?? '?'}`
}

function onOff(enabled: boolean): string {
  return enabled ? 'on' : 'off'
}

// A receiving stage named by its number, as a stage's dry run says what it would hand on.
export function stageNamer(job: JobGroup): (automationId: string) => string {
  return (id) => {
    const to = job.stages.find((s) => s.id === id)
    return to ? stageName(to.job?.stage).toLowerCase() : id
  }
}

export type StageDryRun = { id: string; stage: string; outcome: TickOutcome }

// Dry run each stage on its machine, in stage order. Dry runs only: nothing starts, nothing is handed over, nothing is
// triggered, nothing is stored. A call that throws is that stage's failed outcome.
async function dryRunAll(job: HostedJob): Promise<StageDryRun[]> {
  const results: StageDryRun[] = []
  for (const s of job.stages) {
    let outcome: TickOutcome
    try {
      outcome = await hostRpc<TickOutcome>(
        s.host,
        'pilot.automations.dryRun',
        { id: s.id },
        { timeoutMs: LONG_CALL_MS }
      )
    } catch (e) {
      outcome = { tickId: null, status: 'failed', error: errorText(e), decisions: [] }
    }
    results.push({ id: s.id, stage: stageName(s.job?.stage), outcome })
  }
  return results
}

// What the job is after a toggle: on, off, or which stages are which.
export function jobStateLine(job: JobGroup, enabled: ReadonlyMap<string, boolean>): string {
  const on = job.stages.filter((s) => enabled.get(s.id))
  if (on.length === job.stages.length) {
    return `Job ${job.id} is on.`
  }
  if (on.length === 0) {
    return `Job ${job.id} is off.`
  }
  const each = job.stages.map((s) => `stage ${s.job?.stage} ${onOff(enabled.get(s.id) === true)}`)
  return `Job ${job.id} is partly on: ${each.join(', ')}.`
}

// Every stage not yet in the wanted state, through the one-automation call on its machine, so Pilot applies the same
// caller rules (an agent in a run is refused). Each stage is tried; nothing is rolled back. The lines say which stages
// changed, which were refused and why, then what state the job is in.
async function setAll(job: HostedJob, enabled: boolean): Promise<string[]> {
  const now = new Map(job.stages.map((s) => [s.id, s.enabled]))
  const lines: string[] = []
  for (const s of job.stages.filter((x) => x.enabled !== enabled)) {
    try {
      await hostRpc(s.host, 'pilot.automations.setEnabled', { id: s.id, enabled })
      now.set(s.id, enabled)
      lines.push(`${stageName(s.job?.stage)}: turned ${onOff(enabled)}`)
    } catch (e) {
      lines.push(`${stageName(s.job?.stage)}: refused: ${errorText(e)}`)
    }
  }
  return [...lines, jobStateLine(job, now)]
}

function ConfirmBar({
  count,
  onConfirm,
  onCancel
}: {
  count: number
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <>
      <span className="text-sm">{`Turn on ${stagesText(count)}? They tick on their schedules.`}</span>
      <Button size="sm" onClick={onConfirm}>
        Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </>
  )
}

// Turn on while any stage is off, Turn off while any is on: a partly-on job offers both.
function ButtonBar({
  job,
  busy,
  onDryRun,
  onTurnOn,
  onTurnOff
}: {
  job: JobGroup
  busy: boolean
  onDryRun: () => void
  onTurnOn: () => void
  onTurnOff: () => void
}): React.JSX.Element {
  const anyOff = job.stages.some((s) => !s.enabled)
  const anyOn = job.stages.some((s) => s.enabled)
  return (
    <>
      {busy ? <span className="text-sm text-muted-foreground">Running…</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={onDryRun}>
        Dry run all
      </Button>
      {anyOff ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onTurnOn}>
          Turn on
        </Button>
      ) : null}
      {anyOn ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onTurnOff}>
          Turn off
        </Button>
      ) : null}
    </>
  )
}

// The job page's buttons. Turning stages on asks first, as Run now does: they then tick on their schedules. Dry run
// all's answers go to onDryRun for the page to show.
export function JobControls({
  job,
  onDone,
  onDryRun
}: {
  job: HostedJob
  onDone: () => void
  onDryRun: (results: StageDryRun[]) => void
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

  const dryRun = async (): Promise<void> => {
    setPhase('running')
    setLines([])
    const results = await dryRunAll(job)
    if (!mounted.current) {
      return
    }
    onDryRun(results)
    setPhase('idle')
  }

  const bar =
    phase === 'confirm' ? (
      <ConfirmBar
        count={job.stages.filter((s) => !s.enabled).length}
        onConfirm={() => void run(() => setAll(job, true))}
        onCancel={() => setPhase('idle')}
      />
    ) : (
      <ButtonBar
        job={job}
        busy={phase === 'running'}
        onDryRun={() => void dryRun()}
        onTurnOn={() => setPhase('confirm')}
        onTurnOff={() => void run(() => setAll(job, false))}
      />
    )
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">{bar}</div>
      {lines.map((line) => (
        <p key={line} className="text-sm text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  )
}
