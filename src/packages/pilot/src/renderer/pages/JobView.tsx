import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload
} from '../../shared/api-types'
import { findJob, jobTitle, type JobGroup } from '../../shared/job-stages'
import { pilotRpc } from '../api'
import { JobActivityTimeline } from './ActivityTimeline'
import { DryRunPanel } from './DryRunPanel'
import { errorText } from './format'
import { JobControls, stageNamer, type StageDryRun } from './JobControls'
import { JobStageFlow, type StageCardData } from './JobStageFlow'
import { flowEdges, latestFrom, mergeJobActivity } from './job-flow'
import { emptyActivityText, QuietTicksSwitch, useHideQuiet } from './QuietTicksSwitch'

type StageData = StageCardData & { ticks: ActivityTick[] }
const ACTIVITY = 'activity'

async function stageData(job: JobGroup, skipQuiet: boolean): Promise<StageData[]> {
  return Promise.all(
    job.stages.map(async (summary) => {
      const detail = await pilotRpc<AutomationDetailPayload>('pilot.automations.get', {
        id: summary.id
      })
      const ticks = await pilotRpc<ActivityTick[]>('pilot.automations.activity', {
        id: summary.id,
        limit: 30,
        skipQuiet
      })
      return { summary, detail, ticks }
    })
  )
}

function Tabs({
  stages,
  tab,
  onTab,
  hideQuiet,
  onHideQuiet
}: {
  stages: StageData[]
  tab: string
  onTab: (tab: string) => void
  hideQuiet: boolean
  onHideQuiet: (hide: boolean) => void
}): React.JSX.Element {
  const tabs = [
    { id: ACTIVITY, label: 'Activity' },
    ...stages.map((s) => ({ id: s.summary.id, label: `Stage ${s.summary.job?.stage} YAML` }))
  ]
  return (
    <div className="flex gap-4 border-b border-border/50 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTab(t.id)}
          className={
            tab === t.id ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
          }
        >
          {t.label}
        </button>
      ))}
      {tab === ACTIVITY ? <QuietTicksSwitch hide={hideQuiet} onChange={onHideQuiet} /> : null}
    </div>
  )
}

function TabBody({
  stages,
  tab,
  hideQuiet,
  onOpenStage
}: {
  stages: StageData[]
  tab: string
  hideQuiet: boolean
  onOpenStage: (id: string) => void
}): React.JSX.Element {
  const shown = stages.find((s) => s.summary.id === tab)
  if (shown?.detail) {
    return (
      <pre className="overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
        {shown.detail.yaml}
      </pre>
    )
  }
  const entries = mergeJobActivity(
    stages.map((s) => ({
      stage: s.summary.job?.stage ?? 0,
      checkNames: s.detail?.checkNames ?? [],
      ticks: s.ticks
    }))
  )
  const notes = stages
    .flatMap((s) =>
      (s.detail?.notes ?? []).map((n) => ({ ...n, tag: `Stage ${s.summary.job?.stage ?? 0}` }))
    )
    .sort((a, b) => b.at - a.at)
  return (
    <JobActivityTimeline
      entries={entries}
      notes={notes}
      empty={emptyActivityText(hideQuiet)}
      onOpenStage={onOpenStage}
    />
  )
}

// A job of several automations (their job: blocks share its id): the stages as a flow, one merged Activity, and
// buttons that act on every stage.
export function JobView({
  jobId,
  onBack,
  onOpenStage
}: {
  jobId: string
  onBack: () => void
  onOpenStage: (id: string) => void
}): React.JSX.Element {
  const [job, setJob] = useState<JobGroup | null>(null)
  const [stages, setStages] = useState<StageData[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState(ACTIVITY)
  const [hideQuiet, setHideQuiet] = useHideQuiet()
  const [dryRuns, setDryRuns] = useState<StageDryRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const list = await pilotRpc<AutomationListPayload>('pilot.automations.list')
      const found = findJob(list.automations, jobId)
      const data = found ? await stageData(found, hideQuiet) : []
      if (!mounted.current) {
        return
      }
      setJob(found)
      setStages(data)
      setNow(Date.now())
      setError(null)
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e))
      }
    }
    if (mounted.current) {
      setLoaded(true)
    }
  }, [jobId, hideQuiet])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), 20_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh])

  const crumbs = (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" className="text-muted-foreground" onClick={onBack}>
        Automations
      </button>
      <span className="text-muted-foreground">›</span>
      <span>{job ? jobTitle(job) : jobId}</span>
    </div>
  )
  if (!job) {
    let note = 'Loading…'
    if (loaded) {
      note = error ?? `No automation is part of job ${jobId}.`
    }
    return (
      <div className="flex flex-col gap-3">
        {crumbs}
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {crumbs}
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-lg font-semibold">{jobTitle(job)}</h2>
        <span className="flex-1" />
        <JobControls job={job} onDone={() => void refresh()} onDryRun={setDryRuns} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {dryRuns.map((d) => (
        <DryRunPanel
          key={d.id}
          id={d.id}
          outcome={d.outcome}
          checkNames={stages.find((s) => s.summary.id === d.id)?.detail?.checkNames ?? []}
          tag={d.stage}
          nameOf={stageNamer(job)}
          onClose={() => setDryRuns((all) => all.filter((x) => x.id !== d.id))}
        />
      ))}
      <JobStageFlow
        stages={stages}
        edges={flowEdges(job, latestFrom(stages.map((s) => s.detail)))}
        now={now}
        onOpenStage={onOpenStage}
      />
      <Tabs
        stages={stages}
        tab={tab}
        onTab={setTab}
        hideQuiet={hideQuiet}
        onHideQuiet={setHideQuiet}
      />
      <TabBody stages={stages} tab={tab} hideQuiet={hideQuiet} onOpenStage={onOpenStage} />
    </div>
  )
}
