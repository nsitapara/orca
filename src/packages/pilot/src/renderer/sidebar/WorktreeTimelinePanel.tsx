import { useState } from 'react'
import type {
  AutomationSummary,
  TimelineNext,
  TimelineRun,
  WorktreeTimeline
} from '../../shared/api-types'
import { runStatusWord } from '../../shared/env-text'
import { money } from '../../shared/money'
import { paintRun } from '../../shared/run-views/paint'
import { runStrip } from '../../shared/run-views/strip'
import { clockTime, runStatusLabel, spentLabel, verdictLabel } from '../pages/format'
import { useAutomationsFeed } from '../run-views/automations-feed'
import { envCleanup } from '../run-views/env-lines'
import { openRunFromSidebar } from '../run-views/run-panel-state'
import { RunStrip } from '../run-views/RunStrip'
import { WaitingRow } from '../timeline/WaitingRow'
import { useActiveWorktreePath } from './active-worktree'
import { useWorktreeTimeline } from './timeline-feed'

// Verdicts that only say "nothing to do here": folded away until asked for.
const QUIET: ReadonlySet<string> = new Set(['notdue', 'baselined'])

function whenText(n: TimelineNext): string {
  if (n.nextTickAt === null) {
    return 'Run by hand'
  }
  return `Next tick ${clockTime(n.nextTickAt)}`
}

function quietLabel(showing: boolean, count: number): string {
  if (showing) {
    return 'Hide the ones with nothing due'
  }
  return `Show ${count} with nothing due`
}

function Heading({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function NextRow({ n }: { n: TimelineNext }): React.JSX.Element {
  return (
    <li className="border-l border-border pb-2 pl-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{whenText(n)}</span>
        <span className="rounded bg-muted px-1.5 text-foreground">{`Last check: ${verdictLabel(n.verdict)}`}</span>
      </div>
      <div className="text-sm">{n.automationName}</div>
      <div className="text-xs text-muted-foreground">{n.reason}</div>
    </li>
  )
}

function PanelRun({
  run,
  summary
}: {
  run: TimelineRun
  summary: AutomationSummary | undefined
}): React.JSX.Element {
  const cleanup = envCleanup(run)
  const items = summary ? runStrip(paintRun(summary.chain, { run }).parts, run, null, 4) : []
  return (
    <li className="relative border-l border-border pb-3 pl-4">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <button
        type="button"
        aria-label={`Open ${run.itemLabel} · ${run.automationName}`}
        onClick={() => openRunFromSidebar(run.id)}
        className="flex flex-wrap items-center gap-2 text-left text-xs text-muted-foreground"
      >
        <span>{clockTime(run.startedAt)}</span>
        <span className="rounded bg-muted px-1.5 text-foreground">
          {runStatusWord(run, runStatusLabel)}
        </span>
        {run.costUsd !== null ? <span>{money(run.costUsd)}</span> : null}
      </button>
      <div className="text-sm">{run.automationName}</div>
      {run.outcome ? <div className="text-xs text-muted-foreground">{run.outcome}</div> : null}
      {cleanup ? <div className="text-xs text-muted-foreground">{cleanup}</div> : null}
      {run.inbox.map((item) => (
        <WaitingRow key={item.id} item={item} />
      ))}
      {items.length > 0 ? (
        <RunStrip
          items={items}
          label={`Run ${run.id}`}
          onChip={(chip) => openRunFromSidebar(run.id, chip.part)}
        />
      ) : null}
    </li>
  )
}

function Runs({ runs, empty }: { runs: TimelineRun[]; empty: string }): React.JSX.Element {
  const { byId } = useAutomationsFeed()
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>
  }
  return (
    <ol className="ml-1">
      {runs.map((run) => (
        <PanelRun key={run.id} run={run} summary={byId.get(run.automationId)} />
      ))}
    </ol>
  )
}

function NextList({ next }: { next: TimelineNext[] }): React.JSX.Element {
  if (next.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing due here.</p>
  }
  return (
    <ol className="ml-1">
      {next.map((n) => (
        <NextRow key={`${n.automationId}:${n.itemKey}`} n={n} />
      ))}
    </ol>
  )
}

function TimelineBody({ t }: { t: WorktreeTimeline }): React.JSX.Element {
  const [showQuiet, setShowQuiet] = useState(false)
  const quiet = t.next.filter((n) => QUIET.has(n.verdict))
  const next = showQuiet ? t.next : t.next.filter((n) => !QUIET.has(n.verdict))
  const underRuns = new Set([...t.now, ...t.earlier].flatMap((r) => r.inbox.map((i) => i.id)))
  const loose = t.waiting.filter((i) => !underRuns.has(i.id))
  return (
    <>
      {loose.map((item) => (
        <WaitingRow key={item.id} item={item} />
      ))}
      <div className="flex items-center justify-between">
        <Heading>Next</Heading>
        {quiet.length > 0 ? (
          <button
            type="button"
            className="mt-3 text-xs underline"
            onClick={() => setShowQuiet(!showQuiet)}
          >
            {quietLabel(showQuiet, quiet.length)}
          </button>
        ) : null}
      </div>
      <NextList next={next} />
      <Heading>Now</Heading>
      <Runs runs={t.now} empty="Nothing running." />
      <Heading>Earlier today</Heading>
      <Runs runs={t.earlier} empty="No runs here today." />
    </>
  )
}

function Body({
  path,
  data,
  error
}: {
  path: string | null
  data: WorktreeTimeline | null
  error: string | null
}): React.JSX.Element {
  if (!path) {
    return <p className="text-muted-foreground">Open a worktree to see its automations.</p>
  }
  if (data) {
    return <TimelineBody t={data} />
  }
  if (error) {
    return <p className="text-destructive">{error}</p>
  }
  return <p className="text-muted-foreground">Loading…</p>
}

export function WorktreeTimelinePanel(): React.JSX.Element {
  const path = useActiveWorktreePath()
  const { data, error } = useWorktreeTimeline(path)
  return (
    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Automations
        </div>
        {data && path ? (
          <span className="text-xs text-muted-foreground">{`${spentLabel(data.spentTodayUsd, data.unpricedBuckets)} spent here today`}</span>
        ) : null}
      </div>
      <Body path={path} data={data} error={error} />
      {data && error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
