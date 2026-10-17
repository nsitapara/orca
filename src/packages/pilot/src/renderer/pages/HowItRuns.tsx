import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ActivityPayload, ActivityRun, AutomationSummary } from '../../shared/api-types'
import { paintRun } from '../../shared/run-views/paint'
import { runHeadline, runTimeline } from '../../shared/run-views/timeline'
import { pilotRpc } from '../api'
import { defaultRun, runCandidates } from '../run-views/activity-groups'
import { RunRail } from '../run-views/RunRail'
import { openRun } from '../run-views/run-panel-state'
import { runTone } from '../run-views/tokens'
import { scheduleText } from './AutomationsTable'
import { showPilotAutomation } from './automations-view'
import { clockTime, formatInZone, runStatusLabel } from './format'

export const HOW_POLL_MS = 20_000

function Facts({ summary: s }: { summary: AutomationSummary }): React.JSX.Element {
  const next = s.nextTickAt === null ? 'None' : formatInZone(s.nextTickAt, s.timezone)
  const facts: [string, string][] = [
    ['Schedule', `${scheduleText(s)} (${s.timezone})`],
    ['Next tick', next],
    ['Powers', s.powers.length ? s.powers.join(', ') : 'Nothing outside the worktree'],
    ['Inbox', s.inbox],
    ['Status', s.enabled ? 'Enabled' : 'Paused']
  ]
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// The run How it runs points at: the running one, else the newest. The plan itself shows no run; Open run shows this one's
// timeline.
function LatestRun({
  summary,
  run
}: {
  summary: AutomationSummary
  run: ActivityRun | null
}): React.JSX.Element {
  if (!run) {
    return <p className="text-xs text-muted-foreground">No runs yet</p>
  }
  const parts = paintRun(summary.chain, { run }).parts
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/30 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">Latest run</span>
      <span className="tabular-nums">{clockTime(run.startedAt)}</span>
      <span className="min-w-0 truncate font-mono" title={run.itemLabel}>
        {run.itemLabel}
      </span>
      <span className={cn('rounded px-1.5', runTone(run))}>
        {runHeadline(run, runTimeline(parts, run), runStatusLabel)}
      </span>
      <span className="flex-1" />
      <button type="button" className="underline" onClick={() => openRun(run.id)}>
        Open run
      </button>
      <button
        type="button"
        className="underline"
        onClick={() => showPilotAutomation(summary.id, 'activity')}
      >
        All in Activity
      </button>
    </div>
  )
}

// An automation's plan: its facts, the run it points at, and its chain with the steps numbered. No run is painted on
// it (spec revision 2026-10-16): a run shows as a timeline in the run panel.
export function HowItRuns({ summary }: { summary: AutomationSummary }): React.JSX.Element {
  const [runs, setRuns] = useState<ActivityRun[]>([])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      pilotRpc<ActivityPayload>('pilot.activity.list', {
        automationIds: [summary.id],
        limit: 10,
        skipQuiet: true
      }).then(
        (p) => alive && setRuns(runCandidates(p)),
        () => {}
      )
    }
    load()
    const timer = setInterval(load, HOW_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [summary.id])
  return (
    <div className="flex flex-col gap-3">
      <Facts summary={summary} />
      <LatestRun summary={summary} run={runs.find((r) => r.id === defaultRun(runs)) ?? null} />
      <RunRail parts={summary.chain} />
    </div>
  )
}
