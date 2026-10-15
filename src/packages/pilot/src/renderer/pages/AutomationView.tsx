import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  TickOutcome
} from '../../shared/api-types'
import { findJob, jobTitle, type JobGroup } from '../../shared/job-stages'
import { pilotRpc } from '../api'
import { AutomationOverview } from './AutomationOverview'
import { ActivityTimeline } from './ActivityTimeline'
import { DryRunPanel } from './DryRunPanel'
import { errorText } from './format'
import { emptyActivityText, QuietTicksSwitch, useHideQuiet } from './QuietTicksSwitch'
import { RunControls } from './RunControls'

type Tab = 'overview' | 'activity'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' }
]

// A stage's page is named by its stage ("Stage 2 of 2 · Start a fix session per ticket"): its file's own name is
// usually the job's.
function heading(detail: AutomationDetailPayload, job: JobGroup | null): string {
  const own = detail.summary.job
  if (!own) {
    return detail.summary.name
  }
  const of = job ? ` of ${job.stages.length}` : ''
  return `Stage ${own.stage}${of} · ${own.label}`
}

function crumbName(detail: AutomationDetailPayload): string {
  const own = detail.summary.job
  return own ? `Stage ${own.stage} · ${own.label}` : detail.summary.name
}

// Automations › (a stage's job ›) this page. Each crumb goes where it says, wherever the page was opened from.
function Crumbs({
  detail,
  job,
  onBack,
  onOpenJob
}: {
  detail: AutomationDetailPayload | null
  job: JobGroup | null
  onBack: () => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" className="text-left text-muted-foreground" onClick={onBack}>
        Automations
      </button>
      {job ? (
        <>
          <span className="text-muted-foreground">›</span>
          <button
            type="button"
            className="text-left text-muted-foreground"
            onClick={() => onOpenJob(job.id)}
          >
            {jobTitle(job)}
          </button>
        </>
      ) : null}
      {detail ? (
        <>
          <span className="text-muted-foreground">›</span>
          <span>{crumbName(detail)}</span>
        </>
      ) : null}
    </div>
  )
}

export function AutomationView({
  id,
  onBack,
  onOpenJob
}: {
  id: string
  onBack: () => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<AutomationDetailPayload | null>(null)
  const [job, setJob] = useState<JobGroup | null>(null)
  const [ticks, setTicks] = useState<ActivityTick[]>([])
  const [tab, setTab] = useState<Tab>('activity')
  const [hideQuiet, setHideQuiet] = useHideQuiet()
  const [dryRun, setDryRun] = useState<TickOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const d = await pilotRpc<AutomationDetailPayload>('pilot.automations.get', { id })
      const t = await pilotRpc<ActivityTick[]>('pilot.automations.activity', {
        id,
        limit: 30,
        skipQuiet: hideQuiet
      })
      // A stage's job, for its crumb and how many stages it has.
      const jobId = d.summary.job?.id
      const j = jobId
        ? findJob(
            (await pilotRpc<AutomationListPayload>('pilot.automations.list')).automations,
            jobId
          )
        : null
      if (!mounted.current) {
        return
      }
      setDetail(d)
      setJob(j)
      setTicks(t)
      setError(null)
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e))
      }
    }
  }, [id, hideQuiet])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), 20_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh])

  const crumbs = <Crumbs detail={detail} job={job} onBack={onBack} onOpenJob={onOpenJob} />
  if (!detail) {
    return (
      <div className="flex flex-col gap-3">
        {crumbs}
        <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {error ?? 'Loading…'}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {crumbs}
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-lg font-semibold">{heading(detail, job)}</h2>
        <span className="flex-1" />
        <RunControls id={id} onDone={() => void refresh()} onDryRun={setDryRun} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {dryRun ? (
        <DryRunPanel
          id={id}
          outcome={dryRun}
          checkNames={detail.checkNames}
          onClose={() => setDryRun(null)}
        />
      ) : null}
      <div className="flex gap-4 border-b border-border/50 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
            }
          >
            {t.label}
          </button>
        ))}
        {tab === 'activity' ? <QuietTicksSwitch hide={hideQuiet} onChange={setHideQuiet} /> : null}
      </div>
      {tab === 'activity' ? (
        <ActivityTimeline
          ticks={ticks}
          checkNames={detail.checkNames}
          notes={detail.notes ?? []}
          empty={emptyActivityText(hideQuiet)}
        />
      ) : (
        <AutomationOverview detail={detail} />
      )}
    </div>
  )
}
