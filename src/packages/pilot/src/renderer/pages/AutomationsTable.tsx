import { createContext, useContext, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ActivityRun, AutomationSummary } from '../../shared/api-types'
import {
  jobEnabled,
  jobLastTick,
  jobTitle,
  listEntries,
  type JobGroup
} from '../../shared/job-stages'
import {
  loadFolded,
  loadSort,
  nextSort,
  saveFolded,
  saveSort,
  sortEntries,
  type SortColumn,
  type SortState
} from './automations-sort'
import { lastTickText } from './format'
import { jobRefusal, rowRefusal } from '../hosts/automation-home'
import { MachineChips } from '../hosts/MachineChip'
import { hostedRunKey } from '../hosts/merge-activity'
import { hostOf, type PilotHostRef } from '../hosts/pilot-host'
import { foldStrip, liveStrip, type StripChip, type StripItem } from '../../shared/run-views/strip'
import { RunStrip } from '../run-views/RunStrip'
import { openRun } from '../run-views/run-panel-state'
import { showActivity, showPilotAutomation } from './automations-view'
import { EnabledSwitch, type Toggle, type ToggleRow } from './EnabledSwitch'

// Names and ticks truncate, so the columns can be narrow. Below the sum of their minimums (TABLE_MIN) the table
// scrolls inside its own box instead of pushing the page sideways.
const COLS =
  'grid grid-cols-[minmax(9rem,2fr)_minmax(9rem,2.5fr)_minmax(5rem,1fr)_minmax(7rem,1.5fr)_6rem] gap-3'
const TABLE_MIN = 'min-w-[40.5rem]'
const ROW = 'min-h-11 w-full border-t border-border/50 px-3 py-3 text-left text-sm hover:bg-accent'
// Same padding as ROW so the stage's cells line up with the headers; the indent is inside its name cell.
const STAGE_ROW = 'min-h-9 w-full bg-muted/30 px-3 py-2 text-left text-sm hover:bg-accent'

// The machines not answering right now: a row whose runs_on names one won't switch here.
const FailedHostsContext = createContext<readonly PilotHostRef[]>([])

// A row of the merged list names its home and every machine it is loaded on; a list from one machine has neither.
type ListedAutomation = AutomationSummary & { host?: PilotHostRef; hosts?: readonly PilotHostRef[] }

export function scheduleText(a: AutomationSummary): string {
  return a.schedule === 'manual' ? 'Run by hand' : a.schedule
}

export function stagesText(count: number): string {
  return count === 1 ? '1 stage' : `${count} stages`
}

// A merged row's live runs name their machines; an untagged one is this machine's.
type ListedLive = { id: string; live: readonly (ActivityRun & { host?: PilotHostRef })[] }

// The list's strip, its chips naming their runs by hostedRunKey: two machines' live runs can share an id.
function listStrip(a: Pick<AutomationSummary, 'chain'> & ListedLive): StripChip[] {
  return liveStrip(a.chain, a.live, hostedRunKey)
}

// A chip on the list (spec §2 Strip): the one live run it is lit for, on its machine; Activity filtered to this
// automation when it is lit for several, else its How it runs.
export function openChip(a: ListedLive, chip: StripChip): void {
  const only =
    chip.runIds.length === 1 ? a.live.find((r) => hostedRunKey(r) === chip.runIds[0]) : null
  if (only) {
    openRun(only.id, chip.part, hostOf(only))
    return
  }
  if (chip.runIds.length > 1) {
    showActivity([a.id])
    return
  }
  showPilotAutomation(a.id, 'how')
}

function RunsCell({ a }: { a: AutomationSummary }): React.JSX.Element {
  return (
    <RunStrip
      items={foldStrip(listStrip(a))}
      label={`${a.name} runs`}
      onChip={(chip) => openChip(a, chip)}
    />
  )
}

function stagesMore(rest: number): StripItem[] {
  if (rest <= 0) {
    return []
  }
  return [{ kind: 'more', key: 'stages', count: rest, unit: rest === 1 ? 'stage' : 'stages' }]
}

function JobRunsCell({ job }: { job: JobGroup }): React.JSX.Element {
  const stage = job.stages.find((s) => s.live.length > 0) ?? job.stages[0]
  const rest = job.stages.length - 1
  const extra = stagesMore(rest)
  return (
    <RunStrip
      items={[...foldStrip(listStrip(stage)), ...extra]}
      label={`${jobTitle(job)} runs`}
      onChip={(chip) => openChip(stage, chip)}
    />
  )
}

function toggleRow(a: ListedAutomation): ToggleRow {
  return { id: a.id, host: hostOf(a) }
}

function statusText(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Paused'
}

function jobStatusText(job: JobGroup): string {
  const on = job.stages.filter((s) => s.enabled).length
  if (on > 0 && on < job.stages.length) {
    return 'Partly on'
  }
  return statusText(on > 0)
}

// A job's switch is on while any stage is: flipping it off turns every stage off, flipping it on turns every one on.
function JobSwitch({
  job,
  onToggle
}: {
  job: JobGroup<ListedAutomation>
  onToggle: Toggle
}): React.JSX.Element {
  const on = jobEnabled(job)
  const rows = job.stages.filter((s) => s.enabled === on).map(toggleRow)
  const failed = useContext(FailedHostsContext)
  return (
    <EnabledSwitch
      name={`Job ${jobTitle(job)}`}
      on={on}
      text={jobStatusText(job)}
      refusal={jobRefusal(job, failed).reason}
      onToggle={() => onToggle(rows, !on)}
    />
  )
}

function AutomationSwitch({
  a,
  name,
  onToggle
}: {
  a: ListedAutomation
  name: string
  onToggle: Toggle
}): React.JSX.Element {
  const failed = useContext(FailedHostsContext)
  return (
    <EnabledSwitch
      name={name}
      on={a.enabled}
      text={statusText(a.enabled)}
      refusal={rowRefusal(a, failed)}
      onToggle={() => onToggle([toggleRow(a)], !a.enabled)}
    />
  )
}

function lastText(a: Pick<AutomationSummary, 'lastTick'>, now: number): string {
  return a.lastTick ? lastTickText(a.lastTick, now) : 'Never'
}

function Row({
  a,
  now,
  onOpen,
  onToggle
}: {
  a: ListedAutomation
  now: number
  onOpen: (id: string) => void
  onToggle: Toggle
}): React.JSX.Element {
  return (
    <div onClick={() => onOpen(a.id)} className={`${COLS} ${ROW} cursor-pointer`}>
      <span className="flex min-w-0 items-center gap-2">
        <button type="button" className="min-w-0 truncate text-left font-medium">
          {a.name}
        </button>
        <MachineChips hosts={a.hosts ?? []} />
      </span>
      <RunsCell a={a} />
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span className="truncate text-muted-foreground">{lastText(a, now)}</span>
      <AutomationSwitch a={a} name={a.name} onToggle={onToggle} />
    </div>
  )
}

function StageRow({
  a,
  now,
  onOpen,
  onToggle
}: {
  a: ListedAutomation
  now: number
  onOpen: (id: string) => void
  onToggle: Toggle
}): React.JSX.Element {
  const label = a.job?.label ?? a.name
  return (
    <div onClick={() => onOpen(a.id)} className={`${COLS} ${STAGE_ROW} cursor-pointer`}>
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={`Stage ${a.job?.stage ?? ''} ${label}`}
          className="flex min-w-0 items-baseline gap-3 pl-7 text-left"
        >
          <span className="font-mono text-xs text-muted-foreground">{a.job?.stage}</span>
          <span className="truncate">{label}</span>
        </button>
        <MachineChips hosts={a.hosts ?? []} />
      </span>
      <RunsCell a={a} />
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span className="truncate text-muted-foreground">{lastText(a, now)}</span>
      <AutomationSwitch a={a} name={`Stage ${a.job?.stage ?? ''} ${label}`} onToggle={onToggle} />
    </div>
  )
}

// A job of several automations: one row for the job (its combined state and newest tick), its stages under it.
function JobRows({
  job,
  now,
  onOpen,
  onOpenJob,
  onToggle
}: {
  job: JobGroup<ListedAutomation>
  now: number
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
  onToggle: Toggle
}): React.JSX.Element {
  const title = jobTitle(job)
  const count = stagesText(job.stages.length)
  const [folded, setFolded] = useState(() => loadFolded(job.id))
  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    saveFolded(job.id, !folded)
    setFolded(!folded)
  }
  const Chevron = folded ? ChevronRight : ChevronDown
  return (
    <div>
      <div
        onClick={() => onOpenJob(job.id)}
        className={`${COLS} ${ROW} cursor-pointer bg-muted/30`}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <button
            type="button"
            aria-expanded={!folded}
            aria-label={folded ? 'Show stages' : 'Hide stages'}
            onClick={toggle}
            className="-m-1 shrink-0 rounded p-1 hover:bg-accent"
          >
            <Chevron className="size-3 text-muted-foreground" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Job ${title}, ${count}`}
            className="flex min-w-0 items-center gap-2 text-left font-medium"
          >
            <span className="truncate">{title}</span>
            <Badge variant="outline" className="shrink-0">
              {count}
            </Badge>
          </button>
          <MachineChips hosts={job.stages.flatMap((s) => s.hosts ?? [])} />
        </span>
        <JobRunsCell job={job} />
        <span />
        <span className="truncate text-muted-foreground">
          {lastText({ lastTick: jobLastTick(job) }, now)}
        </span>
        <JobSwitch job={job} onToggle={onToggle} />
      </div>
      {folded
        ? null
        : job.stages.map((s) => (
            <StageRow key={s.id} a={s} now={now} onOpen={onOpen} onToggle={onToggle} />
          ))}
    </div>
  )
}

const HEADERS: [SortColumn, string][] = [
  ['name', 'Name'],
  ['looksAt', 'Runs'],
  ['schedule', 'Schedule'],
  ['lastTick', 'Last tick'],
  ['status', 'Status']
]

function ariaSort(sort: SortState, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort.column !== column) {
    return 'none'
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function sortMark(sort: SortState, column: SortColumn): string {
  if (sort.column !== column) {
    return ''
  }
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
}

const NONE_FAILED: readonly PilotHostRef[] = []

export function AutomationsTable({
  payload,
  now,
  failedHosts = NONE_FAILED,
  onOpen,
  onOpenJob,
  onToggle
}: {
  payload: { automations: ListedAutomation[] }
  now: number
  failedHosts?: readonly PilotHostRef[]
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
  onToggle: Toggle
}): React.JSX.Element {
  const [sort, setSort] = useState<SortState>(loadSort)
  const choose = (column: SortColumn): void => {
    const next = nextSort(sort, column)
    saveSort(next)
    setSort(next)
  }
  if (!payload.automations.length) {
    return <p className="text-sm text-muted-foreground">No automations found.</p>
  }
  return (
    <FailedHostsContext value={failedHosts}>
      <div className="overflow-x-auto rounded-md border border-border/50 bg-muted/20">
        <div className={TABLE_MIN}>
          <div
            role="row"
            className={`${COLS} h-8 items-center px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground`}
          >
            {HEADERS.map(([column, label]) => (
              <span key={column} role="columnheader" aria-sort={ariaSort(sort, column)}>
                <button
                  type="button"
                  onClick={() => choose(column)}
                  className="uppercase hover:text-foreground"
                >
                  {label}
                  {sortMark(sort, column)}
                </button>
              </span>
            ))}
          </div>
          {sortEntries(listEntries(payload.automations), sort).map((entry) =>
            entry.kind === 'job' ? (
              <JobRows
                key={`job:${entry.id}`}
                job={entry}
                now={now}
                onOpen={onOpen}
                onOpenJob={onOpenJob}
                onToggle={onToggle}
              />
            ) : (
              <Row
                key={entry.automation.id}
                a={entry.automation}
                now={now}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            )
          )}
        </div>
      </div>
    </FailedHostsContext>
  )
}
