import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TickOutcome } from '../../shared/api-types'
import { workspacePreviewLines } from '../../shared/env-text'
import { handoverPreviewLines } from '../../shared/handover-text'
import type { JobGroup } from '../../shared/job-stages'
import { pilotRpc } from '../api'
import { stagesText } from './AutomationsTable'
import { errorText, outcomeLine } from './format'
import { LONG_CALL_MS } from './RunControls'

type Phase = 'idle' | 'confirm' | 'running'

function stageName(n: number | undefined): string {
  return `Stage ${n ?? '?'}`
}

function onOff(enabled: boolean): string {
  return enabled ? 'on' : 'off'
}

// What a stage's dry run says it would read and hand on, the receiving stage named by its number.
function handoverLines(job: JobGroup, result: TickOutcome, stage: string): string[] {
  if (!('handover' in result) || !result.handover) {
    return []
  }
  const nameOf = (id: string): string => {
    const to = job.stages.find((s) => s.id === id)
    return to ? stageName(to.job?.stage).toLowerCase() : id
  }
  return handoverPreviewLines(result.handover, true, nameOf).map((line) => `${stage}: ${line}`)
}

// Dry run each stage, in stage order. Dry runs only: nothing starts, nothing is handed over, nothing is triggered;
// each stage says what it would read and hand on.
async function dryRunAll(job: JobGroup): Promise<string[]> {
  const lines: string[] = []
  for (const s of job.stages) {
    const stage = stageName(s.job?.stage)
    try {
      const result = await pilotRpc<TickOutcome>(
        'pilot.automations.dryRun',
        { id: s.id },
        { timeoutMs: LONG_CALL_MS }
      )
      lines.push(
        `${stage}: ${outcomeLine(result, s.id)}`,
        ...handoverLines(job, result, stage),
        ...workspacePreviewLines(result).map((line) => `${stage}: ${line}`)
      )
    } catch (e) {
      lines.push(`${stageName(s.job?.stage)}: ${errorText(e)}`)
    }
  }
  return lines
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

// Every stage not yet in the wanted state, through the one-automation call, so Pilot applies the same caller rules
// (an agent in a run is refused). Each stage is tried; nothing is rolled back. The lines say which stages changed,
// which were refused and why, then what state the job is in.
async function setAll(job: JobGroup, enabled: boolean): Promise<string[]> {
  const now = new Map(job.stages.map((s) => [s.id, s.enabled]))
  const lines: string[] = []
  for (const s of job.stages.filter((x) => x.enabled !== enabled)) {
    try {
      await pilotRpc('pilot.automations.setEnabled', { id: s.id, enabled })
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

// The job page's buttons. Turning stages on asks first, as Run now does: they then tick on their schedules.
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
        onDryRun={() => void run(() => dryRunAll(job))}
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
