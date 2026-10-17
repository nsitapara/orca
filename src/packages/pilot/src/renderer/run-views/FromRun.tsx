import { cn } from '@/lib/utils'
import type { ActivityRun, AutomationSummary, InboxListRow } from '../../shared/api-types'
import { money } from '../../shared/money'
import { paintRun } from '../../shared/run-views/paint'
import { runStrip } from '../../shared/run-views/strip'
import { runHeadline, runTimeline } from '../../shared/run-views/timeline'
import { hostOf, type PilotHostRef } from '../hosts/pilot-host'
import { clockTime, runStatusLabel } from '../pages/format'
import { useAutomationsFeed } from './automations-feed'
import { ContinueRun } from './ContinueRun'
import { RunStrip, useRunStripLabel } from './RunStrip'
import { openRun } from './run-panel-state'
import { RUN_TONE } from './tokens'

type Asked = Pick<InboxListRow, 'automationId' | 'stepIdx'>

// The part a card waits on: its step (an answer run's steps are keyed answer:N), or the ask before any step.
export function askingPart(
  item: Pick<InboxListRow, 'stepIdx'>,
  run: Pick<ActivityRun, 'trigger'>
): string {
  if (item.stepIdx === null) {
    return 'ask'
  }
  if (run.trigger === 'answer') {
    return `answer:${item.stepIdx}`
  }
  return `step:${item.stepIdx}`
}

// "10:53 AM–11:21 AM", or "since 10:53 AM" while it runs.
export function runSpan(run: Pick<ActivityRun, 'startedAt' | 'finishedAt'>): string {
  if (run.finishedAt === null) {
    return `since ${clockTime(run.startedAt)}`
  }
  return `${clockTime(run.startedAt)}–${clockTime(run.finishedAt)}`
}

type HostedRun = ActivityRun & { host?: PilotHostRef }

// A card's "From run" block: the run's state, times, cost and item, then the steps that ran in order with the one the
// card came from lit amber, and Open run at that step, on the run's machine.
export function FromRun({
  item,
  run
}: {
  item: Asked
  // An untagged run is this machine's.
  run: HostedRun | null
}): React.JSX.Element | null {
  const summary = useAutomationsFeed().byId.get(item.automationId)
  if (!run || !summary) {
    return null
  }
  return <FromRunBlock item={item} run={run} summary={summary} />
}

function FromRunBlock({
  item,
  run,
  summary
}: {
  item: Asked
  run: HostedRun
  summary: AutomationSummary
}): React.JSX.Element {
  const host = hostOf(run)
  const label = useRunStripLabel(run.id, host)
  const parts = paintRun(summary.chain, { run }).parts
  const asked = askingPart(item, run)
  return (
    <div data-from-run="" className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">From run</span>
        <span className={cn('rounded px-1.5', RUN_TONE[run.status])}>
          {runHeadline(run, runTimeline(parts, run), runStatusLabel)}
        </span>
        <span className="tabular-nums">{runSpan(run)}</span>
        {run.costUsd !== null ? <span className="tabular-nums">{money(run.costUsd)}</span> : null}
        <span className="min-w-0 truncate font-mono" title={run.itemLabel}>
          {run.itemLabel}
        </span>
        <span className="flex-1" />
        <ContinueRun run={run} />
        <button type="button" className="underline" onClick={() => openRun(run.id, asked, host)}>
          Open run
        </button>
      </div>
      <RunStrip
        items={runStrip(parts, run, asked)}
        label={label}
        highlight={asked}
        onChip={(chip) => openRun(run.id, chip.part, host)}
      />
    </div>
  )
}
