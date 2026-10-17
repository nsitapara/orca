import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { SessionResumeResult, StepRow } from '../../shared/api-types'
import { money } from '../../shared/money'
import { pilotRpc } from '../api'
import { errorText, stepStatusLabel } from '../pages/format'
import { refreshWorktreeTimeline } from '../sidebar/timeline-feed'
import { StepResultView } from '../timeline/StepResult'
import { ShellOutput, StepLog } from './StepLog'

const AGENT_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' }
const RESUMED: Record<SessionResumeResult['action'], string> = {
  focused: 'Switched to its tab',
  opened: 'Opened in a new tab'
}

export function canResume(step: StepRow): boolean {
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

function errorClass(step: StepRow): string {
  if (step.status === 'failed' || step.status === 'timed_out') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

function outputsText(step: StepRow): string | null {
  const entries = Object.entries(step.outputs)
  if (entries.length === 0) {
    return null
  }
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')
}

export function ResumeButton({
  runId,
  worktreePath,
  step
}: {
  runId: string
  worktreePath: string | null
  step: StepRow
}): React.JSX.Element {
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
      if (worktreePath) {
        refreshWorktreeTimeline(worktreePath)
      }
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

// What one step stored (spec §2 Rail: a step row's expansion): who ran it and how it ended, its outputs, its pilotcli
// result (a meta.text result shows only its outcome and reason), its error, and Resume for an agent's session.
export function StepDetail({
  runId,
  worktreePath = null,
  checkoutRemoved = false,
  step
}: {
  runId: string
  worktreePath?: string | null
  checkoutRemoved?: boolean
  step: StepRow
}): React.JSX.Element {
  const outputs = outputsText(step)
  // Why: the server refuses a resume from a paired device, so the browser has nothing to offer.
  const resumable = canResume(step) && !isWebClientLocation()
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{stepFacts(step)}</span>
        {resumable && !checkoutRemoved ? (
          <ResumeButton runId={runId} worktreePath={worktreePath} step={step} />
        ) : null}
        {resumable && checkoutRemoved ? (
          <span className="text-muted-foreground">Checkout removed</span>
        ) : null}
      </div>
      {outputs ? <div className="text-muted-foreground">{`Outputs: ${outputs}`}</div> : null}
      {step.result ? <StepResultView result={step.result} /> : null}
      {step.error ? <div className={errorClass(step)}>{step.error}</div> : null}
      {step.kind === 'shell' && step.outputTail ? <ShellOutput text={step.outputTail} /> : null}
      {step.kind === 'agent' ? <StepLog runId={runId} step={step} /> : null}
    </div>
  )
}
