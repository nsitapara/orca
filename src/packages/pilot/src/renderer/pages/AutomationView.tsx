import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary,
  TickOutcome
} from '../../shared/api-types'
import { findJob, jobTitle, type JobGroup } from '../../shared/job-stages'
import { automationHome } from '../hosts/automation-home'
import { hostRpc } from '../hosts/host-rpc'
import type { MergedAutomation } from '../hosts/merge-automations'
import type { PilotHostRef } from '../hosts/pilot-host'
import { usePilotHosts } from '../hosts/pilot-hosts-feed'
import { runNowChoices } from '../hosts/run-now-hosts'
import { ActivityView } from '../run-views/ActivityView'
import {
  setPilotAutomationTab,
  usePilotAutomationTab,
  type AutomationTab
} from './automations-view'
import { DryRunPanel } from './DryRunPanel'
import { errorText } from './format'
import { HowItRuns } from './HowItRuns'
import { RunControls } from './RunControls'

const TABS: { id: AutomationTab; label: string }[] = [
  { id: 'how', label: 'How it runs' },
  { id: 'activity', label: 'Activity' },
  { id: 'yaml', label: 'YAML' }
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

// A stage's job, for its crumb and how many stages it has: from the list its home was found in, else its home's own.
async function jobOf(
  detail: AutomationDetailPayload,
  home: PilotHostRef,
  listed: readonly AutomationSummary[] | null
): Promise<JobGroup | null> {
  const jobId = detail.summary.job?.id
  if (!jobId) {
    return null
  }
  const automations =
    listed ?? (await hostRpc<AutomationListPayload>(home, 'pilot.automations.list')).automations
  return findJob(automations, jobId)
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
  // Where its buttons' calls go; null while they're refused.
  const [home, setHome] = useState<PilotHostRef | null>(null)
  // Its row in every machine's list, for where Run now may start it; null with one machine.
  const [row, setRow] = useState<MergedAutomation | null>(null)
  const hosts = usePilotHosts()
  const [refusal, setRefusal] = useState<string | null>(null)
  const tab = usePilotAutomationTab()
  const [dryRun, setDryRun] = useState<TickOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const found = await automationHome(id)
      if (found.kind === 'refused') {
        if (mounted.current) {
          setHome(null)
          setRow(null)
          setRefusal(found.reason)
          setError(null)
        }
        return
      }
      const d = await hostRpc<AutomationDetailPayload>(found.host, 'pilot.automations.get', { id })
      const j = await jobOf(d, found.host, found.automations)
      if (!mounted.current) {
        return
      }
      setDetail(d)
      setJob(j)
      setHome(found.host)
      setRow(found.automations?.find((a) => a.id === id) ?? null)
      setRefusal(null)
      setError(null)
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e))
      }
    }
  }, [id])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), 20_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh])

  // One machine runs it as before, with no picker.
  const choices = row && hosts.length > 1 ? runNowChoices(row, hosts) : undefined
  const crumbs = <Crumbs detail={detail} job={job} onBack={onBack} onOpenJob={onOpenJob} />
  if (!detail) {
    const note = refusal ?? error
    return (
      <div className="flex flex-col gap-3">
        {crumbs}
        <p className={note ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {note ?? 'Loading…'}
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
        {home ? (
          <RunControls
            id={id}
            host={home}
            choices={choices}
            row={row}
            onDone={() => void refresh()}
            onDryRun={setDryRun}
          />
        ) : null}
      </div>
      {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {dryRun ? (
        <DryRunPanel
          id={id}
          outcome={dryRun}
          checkNames={detail.checkNames}
          onClose={() => setDryRun(null)}
        />
      ) : null}
      <div role="tablist" className="flex gap-4 border-b border-border/50 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setPilotAutomationTab(t.id)}
            className={
              tab === t.id ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'how' ? <HowItRuns summary={detail.summary} /> : null}
      {tab === 'activity' ? (
        <ActivityView automationIds={[id]} since={null} limit={30} notes={detail.notes ?? []} />
      ) : null}
      {tab === 'yaml' ? (
        <pre className="overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
          {detail.yaml}
        </pre>
      ) : null}
    </div>
  )
}
