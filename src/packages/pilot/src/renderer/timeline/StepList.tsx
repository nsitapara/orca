import type { StepRow } from '../../shared/api-types'
import { StepDetail } from '../run-views/StepDetail'

export function StepList({
  runId,
  worktreePath = null,
  checkoutRemoved = false,
  steps
}: {
  runId: string
  worktreePath?: string | null
  checkoutRemoved?: boolean
  steps: StepRow[]
}): React.JSX.Element {
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">No steps started.</p>
  }
  return (
    <ol className="mt-1 space-y-1 text-xs">
      {steps.map((step) => (
        <li key={step.idx}>
          <span className="font-medium">{`${step.idx + 1}. ${step.name}`}</span>
          <StepDetail
            runId={runId}
            worktreePath={worktreePath}
            checkoutRemoved={checkoutRemoved}
            step={step}
          />
        </li>
      ))}
    </ol>
  )
}
