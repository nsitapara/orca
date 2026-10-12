import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { SessionResumeResult, StepRow } from '../../shared/api-types'
import { money } from '../../shared/money'
import { pilotRpc } from '../api'
import { errorText, stepStatusLabel } from '../pages/format'

const AGENT_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' }
const RESUMED: Record<SessionResumeResult['action'], string> = {
  focused: 'Switched to its tab',
  opened: 'Opened in a new tab'
}

function canResume(step: StepRow): boolean {
  return step.sessionId !== null && (step.agent === 'claude' || step.agent === 'codex')
}

function stepFacts(step: StepRow): string {
  const parts = [AGENT_LABEL[step.agent] ?? step.agent]
  if (step.mode) {
    parts.push(`mode ${step.mode}`)
  }
  parts.push(stepStatusLabel(step.status))
  if (step.costUsd !== null) {
    parts.push(money(step.costUsd))
  }
  if (step.exitCode !== null) {
    parts.push(`exit ${step.exitCode}`)
  }
  return parts.join(' · ')
}

function outputsText(step: StepRow): string | null {
  const entries = Object.entries(step.outputs)
  if (entries.length === 0) {
    return null
  }
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')
}

function ResumeButton({ runId, step }: { runId: string; step: StepRow }): React.JSX.Element {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resume = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await pilotRpc<SessionResumeResult>('pilot.session.resume', {
        runId,
        stepIdx: step.idx
      })
      setNote(RESUMED[result.action])
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1 underline"
        onClick={() => void resume()}
      >
        <RotateCcw size={12} />
        Resume
      </button>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </span>
  )
}

export function StepList({ runId, steps }: { runId: string; steps: StepRow[] }): React.JSX.Element {
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">No steps started.</p>
  }
  return (
    <ol className="mt-1 space-y-1 text-xs">
      {steps.map((step) => {
        const outputs = outputsText(step)
        return (
          <li key={step.idx}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{`${step.idx + 1}. ${step.name}`}</span>
              <span className="text-muted-foreground">{stepFacts(step)}</span>
              {canResume(step) ? <ResumeButton runId={runId} step={step} /> : null}
            </div>
            {outputs ? <div className="text-muted-foreground">{`Outputs: ${outputs}`}</div> : null}
            {step.error ? <div className="text-destructive">{step.error}</div> : null}
          </li>
        )
      })}
    </ol>
  )
}
