import { useState } from 'react'
import type { InboxItemSummary, RunRow, StepRow } from '../../shared/api-types'
import { money } from '../../shared/money'
import { clockTime, runStatusLabel } from '../pages/format'
import { StepList } from './StepList'
import { WaitingRow } from './WaitingRow'

export type RunWithDetail = RunRow & { steps: StepRow[]; inbox: InboxItemSummary[] }

function stepsLabel(n: number): string {
  if (n === 1) {
    return '1 step'
  }
  return `${n} steps`
}

// One run on a timeline: when, status, cost, what it was about, its outcome, what it asked, and its steps.
export function RunCard({ run, title }: { run: RunWithDetail; title: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const toggle = open ? 'Hide steps' : stepsLabel(run.steps.length)
  return (
    <li className="relative border-l border-border pb-3 pl-4">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{clockTime(run.startedAt)}</span>
        <span className="rounded bg-muted px-1.5 text-foreground">
          {runStatusLabel(run.status)}
        </span>
        {run.costUsd !== null ? <span>{money(run.costUsd)}</span> : null}
      </div>
      <div className="text-sm">{title}</div>
      {run.outcome ? <div className="text-xs text-muted-foreground">{run.outcome}</div> : null}
      {run.inbox.map((item) => (
        <WaitingRow key={item.id} item={item} />
      ))}
      {run.steps.length > 0 ? (
        <button type="button" className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>
          {toggle}
        </button>
      ) : null}
      {open ? <StepList runId={run.id} worktreePath={run.worktreePath} steps={run.steps} /> : null}
    </li>
  )
}
