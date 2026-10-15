import { useEffect, useState } from 'react'
import type {
  ActivityPayload,
  ActivityRun,
  AutomationSummary,
  RunDetail
} from '../../shared/api-types'
import { paintRun } from '../../shared/run-views/paint'
import { pilotRpc } from '../api'
import { defaultRun, runCandidates } from '../run-views/activity-groups'
import { RunRail } from '../run-views/RunRail'
import { closeRunPanel, openRun } from '../run-views/run-panel-state'
import { scheduleText } from './AutomationsTable'
import { showInboxCard } from './automations-view'
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

function runLabel(r: ActivityRun): string {
  return `${clockTime(r.startedAt)} · ${r.itemLabel} · ${runStatusLabel(r.status)}`
}

function RunPicker({
  runs,
  value,
  onChange
}: {
  runs: ActivityRun[]
  value: string | null
  onChange: (id: string | null) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Run</span>
      <select
        aria-label="Run"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
      >
        <option value="">No run</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {runLabel(r)}
          </option>
        ))}
      </select>
    </label>
  )
}

// An automation's chain with one run painted on it: the running run by default, else the newest; "No run" shows the
// bare chain. Its facts (once the Overview's) head it.
export function HowItRuns({ summary }: { summary: AutomationSummary }): React.JSX.Element {
  const [runs, setRuns] = useState<ActivityRun[]>([])
  // undefined: not picked, so the default; null: No run.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [detail, setDetail] = useState<RunDetail | null>(null)
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
  const chosen = picked === undefined ? defaultRun(runs) : picked
  useEffect(() => {
    if (!chosen) {
      setDetail(null)
      return
    }
    let alive = true
    pilotRpc<RunDetail>('pilot.runs.get', { runId: chosen }).then(
      (d) => alive && setDetail(d),
      () => alive && setDetail(null)
    )
    return () => {
      alive = false
    }
  }, [chosen, runs])
  const shown = detail && detail.run.id === chosen ? detail : null
  const painted = shown ? paintRun(shown.chain, shown) : null
  return (
    <div className="flex flex-col gap-3">
      <Facts summary={summary} />
      <RunPicker runs={runs} value={chosen} onChange={setPicked} />
      <RunRail
        key={shown?.run.id ?? 'chain'}
        parts={painted ? painted.parts : summary.chain}
        run={shown ? shown.run : null}
        drifted={painted?.drifted ?? false}
        onOpenRun={(id) => openRun(id)}
        onOpenCard={(id) => {
          closeRunPanel()
          showInboxCard(id)
        }}
      />
    </div>
  )
}
