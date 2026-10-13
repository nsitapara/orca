import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AutomationListPayload, AutomationSummary } from '../../shared/api-types'
import { jobEnabled, jobLastTick, listEntries, type JobGroup } from '../../shared/job-stages'
import { lastTickText } from './format'

const COLS =
  'grid grid-cols-[minmax(14rem,2fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(12rem,1.5fr)_6rem] gap-3'
const ROW = 'min-h-11 w-full border-t border-border/50 px-3 py-3 text-left text-sm hover:bg-accent'
const STAGE_ROW = 'min-h-9 w-full bg-muted/30 py-2 pl-10 pr-3 text-left text-sm hover:bg-accent'

export function scheduleText(a: AutomationSummary): string {
  return a.schedule === 'manual' ? 'Run by hand' : a.schedule
}

export function stagesText(count: number): string {
  return count === 1 ? '1 stage' : `${count} stages`
}

// What the job's stages look at, in stage order: "Pipelines → Linear tickets".
export function jobLooksAt(job: JobGroup): string {
  const kinds = job.stages.map((s) => s.itemKind)
  return kinds.filter((k, i) => i === 0 || k !== kinds[i - 1]).join(' → ')
}

export function StatusBadge({ enabled }: { enabled: boolean }): React.JSX.Element {
  return <Badge variant={enabled ? 'secondary' : 'outline'}>{enabled ? 'Enabled' : 'Paused'}</Badge>
}

function lastText(a: Pick<AutomationSummary, 'lastTick'>, now: number): string {
  return a.lastTick ? lastTickText(a.lastTick, now) : 'Never'
}

function Row({
  a,
  now,
  onOpen
}: {
  a: AutomationSummary
  now: number
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <button type="button" onClick={() => onOpen(a.id)} className={`${COLS} ${ROW}`}>
      <span className="truncate font-medium">{a.name}</span>
      <span className="truncate text-muted-foreground">{a.itemKind}</span>
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span className="truncate text-muted-foreground">{lastText(a, now)}</span>
      <span>
        <StatusBadge enabled={a.enabled} />
      </span>
    </button>
  )
}

function StageRow({
  a,
  now,
  onOpen
}: {
  a: AutomationSummary
  now: number
  onOpen: (id: string) => void
}): React.JSX.Element {
  const label = a.job?.label ?? a.name
  return (
    <button
      type="button"
      aria-label={`Stage ${a.job?.stage ?? ''} ${label}`}
      onClick={() => onOpen(a.id)}
      className={`${COLS} ${STAGE_ROW}`}
    >
      <span className="flex min-w-0 items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">{a.job?.stage}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-muted-foreground">{a.itemKind}</span>
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span className="truncate text-muted-foreground">{lastText(a, now)}</span>
      <span>
        <StatusBadge enabled={a.enabled} />
      </span>
    </button>
  )
}

// A job of several automations: one row for the job (its combined state and newest tick), its stages under it.
function JobRows({
  job,
  now,
  onOpen,
  onOpenJob
}: {
  job: JobGroup
  now: number
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  const title = `${job.id} · ${job.name}`
  const count = stagesText(job.stages.length)
  return (
    <div>
      <button
        type="button"
        aria-label={`Job ${title}, ${count}`}
        onClick={() => onOpenJob(job.id)}
        className={`${COLS} ${ROW} bg-muted/30`}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{title}</span>
          <Badge variant="outline" className="shrink-0">
            {count}
          </Badge>
        </span>
        <span className="truncate text-muted-foreground">{jobLooksAt(job)}</span>
        <span />
        <span className="truncate text-muted-foreground">
          {lastText({ lastTick: jobLastTick(job) }, now)}
        </span>
        <span>
          <StatusBadge enabled={jobEnabled(job)} />
        </span>
      </button>
      {job.stages.map((s) => (
        <StageRow key={s.id} a={s} now={now} onOpen={onOpen} />
      ))}
    </div>
  )
}

export function AutomationsTable({
  payload,
  now,
  onOpen,
  onOpenJob
}: {
  payload: AutomationListPayload
  now: number
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  if (!payload.automations.length) {
    return <p className="text-sm text-muted-foreground">No automations found.</p>
  }
  return (
    <div className="rounded-md border border-border/50 bg-muted/20">
      <div
        className={`${COLS} h-8 items-center px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground`}
      >
        <span>Name</span>
        <span>Looks at</span>
        <span>Schedule</span>
        <span>Last tick</span>
        <span>Status</span>
      </div>
      {listEntries(payload.automations).map((entry) =>
        entry.kind === 'job' ? (
          <JobRows
            key={`job:${entry.id}`}
            job={entry}
            now={now}
            onOpen={onOpen}
            onOpenJob={onOpenJob}
          />
        ) : (
          <Row key={entry.automation.id} a={entry.automation} now={now} onOpen={onOpen} />
        )
      )}
    </div>
  )
}
