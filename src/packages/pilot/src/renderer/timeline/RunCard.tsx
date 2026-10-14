import { useState } from 'react'
import type { InboxItemSummary, RunRow, StepRow } from '../../shared/api-types'
import { checkoutRemoved, homeOf } from '../../shared/api-types-env'
import { envCleanupLine, envStackLine, envWhereLine, runStatusWord } from '../../shared/env-text'
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

// Where an env run worked, its stack, and a delete that hasn't succeeded.
function envLines(run: RunRow): string[] {
  const env = run.env
  if (!env) {
    return []
  }
  const ended = run.status !== 'running' && run.status !== 'asking'
  const lines = [envWhereLine(env), envStackLine(env), envCleanupLine(env, ended)]
  return lines.filter((line): line is string => line !== null)
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
          {runStatusWord(run, runStatusLabel)}
        </span>
        {run.costUsd !== null ? <span>{money(run.costUsd)}</span> : null}
      </div>
      <div className="text-sm">{title}</div>
      {run.outcome ? <div className="text-xs text-muted-foreground">{run.outcome}</div> : null}
      {envLines(run).map((line) => (
        <div key={line} className="text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      {run.inbox.map((item) => (
        <WaitingRow key={item.id} item={item} />
      ))}
      {run.steps.length > 0 ? (
        <button type="button" className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>
          {toggle}
        </button>
      ) : null}
      {open ? (
        <StepList
          runId={run.id}
          worktreePath={homeOf(run)}
          checkoutRemoved={checkoutRemoved(run)}
          steps={run.steps}
        />
      ) : null}
    </li>
  )
}
