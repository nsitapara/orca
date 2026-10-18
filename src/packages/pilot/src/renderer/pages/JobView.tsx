import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationDetailPayload } from '../../shared/api-types'
import { findJob, jobTitle, type JobGroup } from '../../shared/job-stages'
import { jobRefusal } from '../hosts/automation-home'
import { hostRpc } from '../hosts/host-rpc'
import { loadMergedAutomations, type MergedAutomation } from '../hosts/merge-automations'
import { ActivityView } from '../run-views/ActivityView'
import { DryRunPanel } from './DryRunPanel'
import { errorText } from './format'
import { JobControls, stageNamer, type StageDryRun } from './JobControls'
import { JobRails, type StageCardData } from './JobRails'
import { flowEdges, latestFrom } from './job-flow'

const HOW = 'how'
const ACTIVITY = 'activity'

type MergedJob = JobGroup<MergedAutomation>

// Each stage from its own home machine; one waiting on a machine that isn't answering isn't read from another.
async function stageData(job: MergedJob, waiting: ReadonlySet<string>): Promise<StageCardData[]> {
  return Promise.all(
    job.stages.map(async (summary) => {
      if (waiting.has(summary.id)) {
        return { summary, detail: null }
      }
      const detail = await hostRpc<AutomationDetailPayload>(summary.host, 'pilot.automations.get', {
        id: summary.id
      })
      return { summary, detail }
    })
  )
}

function Tabs({
  stages,
  tab,
  onTab
}: {
  stages: StageCardData[]
  tab: string
  onTab: (tab: string) => void
}): React.JSX.Element {
  const tabs = [
    { id: HOW, label: 'How it runs' },
    { id: ACTIVITY, label: 'Activity' },
    ...stages.map((s) => ({ id: s.summary.id, label: `Stage ${s.summary.job?.stage} YAML` }))
  ]
  return (
    <div role="tablist" className="flex gap-4 border-b border-border/50 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onTab(t.id)}
          className={
            tab === t.id ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Each stage's notes from before its first tick, tagged with its stage, newest first.
function stageNotes(stages: StageCardData[]) {
  return stages
    .flatMap((s) =>
      (s.detail?.notes ?? []).map((n) => ({ ...n, tag: `Stage ${s.summary.job?.stage ?? 0}` }))
    )
    .sort((a, b) => b.at - a.at)
}

// A job of several automations (their job: blocks share its id): the stages as stacked rails, one Activity, a YAML
// tab per stage, and buttons that act on every stage.
export function JobView({
  jobId,
  onBack,
  onOpenStage
}: {
  jobId: string
  onBack: () => void
  onOpenStage: (id: string) => void
}): React.JSX.Element {
  const [job, setJob] = useState<MergedJob | null>(null)
  const [stages, setStages] = useState<StageCardData[]>([])
  const [refusal, setRefusal] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState(HOW)
  const [dryRuns, setDryRuns] = useState<StageDryRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const merged = await loadMergedAutomations()
      const found = findJob(merged.automations, jobId)
      const refused = jobRefusal(found, merged)
      const data = found ? await stageData(found, refused.waiting) : []
      if (!mounted.current) {
        return
      }
      setJob(found)
      setStages(data)
      setRefusal(refused.reason)
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
  }, [jobId])
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
    let held = false
    if (loaded) {
      held = refusal !== null || error !== null
      note = refusal ?? error ?? `No automation is part of job ${jobId}.`
    }
    return (
      <div className="flex flex-col gap-3">
        {crumbs}
        <p className={held ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {note}
        </p>
      </div>
    )
  }
  const yamlStage = stages.find((s) => s.summary.id === tab)
  return (
    <div className="flex flex-col gap-4">
      {crumbs}
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-lg font-semibold">{jobTitle(job)}</h2>
        <span className="flex-1" />
        {refusal ? null : (
          <JobControls job={job} onDone={() => void refresh()} onDryRun={setDryRuns} />
        )}
      </div>
      {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}
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
      <Tabs stages={stages} tab={tab} onTab={setTab} />
      {tab === HOW ? (
        <JobRails
          stages={stages}
          edges={flowEdges(job, latestFrom(stages.map((s) => s.detail)))}
          now={now}
          onOpenStage={onOpenStage}
        />
      ) : null}
      {tab === ACTIVITY ? (
        <ActivityView
          automationIds={stages.map((s) => s.summary.id)}
          since={null}
          limit={60}
          tags={Object.fromEntries(
            stages.map((s) => [s.summary.id, `Stage ${s.summary.job?.stage ?? 0}`])
          )}
          onTag={onOpenStage}
          notes={stageNotes(stages)}
        />
      ) : null}
      {yamlStage ? (
        <pre className="overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
          {yamlStage.detail?.yaml}
        </pre>
      ) : null}
    </div>
  )
}
