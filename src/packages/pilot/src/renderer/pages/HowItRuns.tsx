import { cn } from '@/lib/utils'
import type { ActivityPayload, ActivityRun, AutomationSummary } from '../../shared/api-types'
import { paintRun } from '../../shared/run-views/paint'
import { runHeadline, runTimeline } from '../../shared/run-views/timeline'
import { useHeldMerge } from '../hosts/held-merge'
import { useHostPoll } from '../hosts/host-poll'
import { MachineChip } from '../hosts/MachineChip'
import { hostedRunKey, mergeActivity } from '../hosts/merge-activity'
import { hostOf, type PilotHostRef } from '../hosts/pilot-host'
import { usePilotHosts } from '../hosts/pilot-hosts-feed'
import { runsOnLine } from '../hosts/runs-on-text'
import { defaultRun, runCandidates } from '../run-views/activity-groups'
import { ACTIVITY_POLL_MS } from '../run-views/ActivityView'
import { RunRail } from '../run-views/RunRail'
import { openRun } from '../run-views/run-panel-state'
import { runTone } from '../run-views/tokens'
import { scheduleText } from './ScheduleCell'
import { showPilotAutomation } from './automations-view'
import { clockTime, formatInZone, runStatusLabel } from './format'

function Facts({ summary: s }: { summary: AutomationSummary }): React.JSX.Element {
  const next = s.nextTickAt === null ? 'None' : formatInZone(s.nextTickAt, s.timezone)
  const runsOn = runsOnLine(s, usePilotHosts())
  // Where a pinned job runs, under its schedule as in the list.
  const schedule = (
    <>
      {`${scheduleText(s)} (${s.timezone})`}
      {runsOn ? (
        <span className={cn('block', runsOn.warn ? 'text-destructive' : 'text-muted-foreground')}>
          {runsOn.text}
        </span>
      ) : null}
    </>
  )
  const facts: [string, React.ReactNode][] = [
    ['Schedule', schedule],
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
  run: (ActivityRun & { host?: PilotHostRef }) | null
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
      <MachineChip host={hostOf(run)} />
      <span className="flex-1" />
      <button
        type="button"
        className="underline"
        onClick={() => openRun(run.id, null, hostOf(run))}
      >
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
  const { reads } = useHostPoll<ActivityPayload>(
    'pilot.activity.list',
    { automationIds: [summary.id], limit: 10, skipQuiet: true },
    ACTIVITY_POLL_MS
  )
  // Every machine's runs of it: the latest may be on any of them.
  const merged = useHeldMerge(reads, mergeActivity)
  const runs = merged ? runCandidates(merged, 10, hostedRunKey) : []
  const latest = defaultRun(runs, hostedRunKey)
  return (
    <div className="flex flex-col gap-3">
      <Facts summary={summary} />
      <LatestRun summary={summary} run={runs.find((r) => hostedRunKey(r) === latest) ?? null} />
      <RunRail parts={summary.chain} />
    </div>
  )
}
