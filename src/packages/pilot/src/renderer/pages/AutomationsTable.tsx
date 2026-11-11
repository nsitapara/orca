import { createContext, useContext, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import ColumnResizeHandle from '@/components/github-project/ColumnResizeHandle'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/class-names'
import type { AutomationSummary } from '../../shared/api-types'
import {
  jobLastTick,
  jobTitle,
  listEntries,
  soonestToTick,
  type JobGroup
} from '../../shared/job-stages'
import {
  DEFAULT_WIDTHS,
  gridTemplate,
  loadWidths,
  resizePair,
  resizeWidths,
  saveWidths,
  type ColumnWidths
} from './automations-column-widths'
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
import { formatInZone, lastTickText, relativeTime } from './format'
import { listRefusal } from '../hosts/automation-home'
import { MachineChips } from '../hosts/MachineChip'
import type { ListedMachines } from '../hosts/merge-automations'
import type { PilotHostRef } from '../hosts/pilot-host'
import type { Toggle } from './EnabledSwitch'
import { AutomationSwitch, JobSwitch, MachinesContext } from './RowSwitches'
import { ScheduleCell } from './ScheduleCell'

// The header and every row are separate grids sharing one template (GridColumns), sized by dragging the header's
// edges. Cells truncate, so columns can be narrow; below TABLE_MIN the table scrolls inside its own box instead of
// pushing the page sideways.
const COLS = 'grid gap-3'
const TABLE_MIN = 'min-w-[36rem]'
const GridColumns = createContext(gridTemplate(DEFAULT_WIDTHS))

function useGridStyle(): React.CSSProperties {
  return { gridTemplateColumns: useContext(GridColumns) }
}
const ROW = 'min-h-11 w-full border-t border-border/50 px-3 py-3 text-left text-sm hover:bg-accent'
// Same padding as ROW so the stage's cells line up with the headers; the indent is inside its name cell.
const STAGE_ROW = 'min-h-9 w-full bg-muted/30 px-3 py-2 text-left text-sm hover:bg-accent'

// A row of the merged list names its home and every machine it is loaded on; a list from one machine has neither.
type ListedAutomation = AutomationSummary & { host?: PilotHostRef; hosts?: readonly PilotHostRef[] }

export function stagesText(count: number): string {
  return count === 1 ? '1 stage' : `${count} stages`
}

// "in 5 min" until the tick is under a minute away; a dash when nothing is scheduled to tick.
function nextText(at: number | null, now: number): string {
  if (at === null) {
    return '—'
  }
  return at - now < 60_000 ? 'Due now' : relativeTime(at, now)
}

function NextTickCell({
  a,
  now
}: {
  a: Pick<AutomationSummary, 'nextTickAt' | 'timezone'> | null
  now: number
}): React.JSX.Element {
  const at = a?.nextTickAt ?? null
  const full = a && at !== null ? formatInZone(at, a.timezone) : undefined
  return (
    <span className="truncate text-muted-foreground" title={full}>
      {nextText(at, now)}
    </span>
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
    <div
      onClick={() => onOpen(a.id)}
      style={useGridStyle()}
      className={`${COLS} ${ROW} cursor-pointer`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <button type="button" className="min-w-0 truncate text-left font-medium">
          {a.name}
        </button>
        <MachineChips hosts={a.hosts ?? []} />
      </span>
      <ScheduleCell a={a} />
      <NextTickCell a={a} now={now} />
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
    <div
      onClick={() => onOpen(a.id)}
      style={useGridStyle()}
      className={`${COLS} ${STAGE_ROW} cursor-pointer`}
    >
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
      <ScheduleCell a={a} />
      <NextTickCell a={a} now={now} />
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
  const style = useGridStyle()
  return (
    <div>
      <div
        onClick={() => onOpenJob(job.id)}
        style={style}
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
        <span />
        <NextTickCell a={soonestToTick(job.stages)} now={now} />
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
  ['schedule', 'Schedule'],
  ['nextTick', 'Next tick'],
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

function RefusalLine({
  refused
}: {
  refused: ReturnType<typeof listRefusal>
}): React.JSX.Element | null {
  if (!refused) {
    return null
  }
  return (
    <p className={cn('text-xs', refused.warn ? 'text-destructive' : 'text-muted-foreground')}>
      {refused.text}
    </p>
  )
}

type Resize = (column: string, width: number, next: string, nextWidth: number) => void

function HeaderCell({
  column,
  label,
  sort,
  widths,
  onSort,
  onResize
}: {
  column: SortColumn
  label: string
  sort: SortState
  widths: ColumnWidths
  onSort: (column: SortColumn) => void
  onResize: Resize
}): React.JSX.Element {
  const pair = resizePair(column)
  return (
    <div role="columnheader" aria-sort={ariaSort(sort, column)} className="relative min-w-0">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="max-w-full truncate uppercase hover:text-foreground"
      >
        {label}
        {sortMark(sort, column)}
      </button>
      {pair ? (
        <ColumnResizeHandle
          fieldId={pair[0]}
          nextFieldId={pair[1]}
          currentWidth={widths[pair[0]]}
          nextWidth={widths[pair[1]]}
          onResize={onResize}
        />
      ) : null}
    </div>
  )
}

function HeaderRow(
  props: Omit<Parameters<typeof HeaderCell>[0], 'column' | 'label'>
): React.JSX.Element {
  return (
    <div
      role="row"
      style={useGridStyle()}
      className={`${COLS} h-8 items-center px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground`}
    >
      {HEADERS.map(([column, label]) => (
        <HeaderCell key={column} column={column} label={label} {...props} />
      ))}
    </div>
  )
}

const NO_MACHINES: ListedMachines = { listedHosts: [], failedHosts: [] }

export function AutomationsTable({
  payload,
  now,
  machines = NO_MACHINES,
  onOpen,
  onOpenJob,
  onToggle
}: {
  payload: { automations: ListedAutomation[] }
  now: number
  machines?: ListedMachines
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
  onToggle: Toggle
}): React.JSX.Element {
  const [sort, setSort] = useState<SortState>(loadSort)
  const [widths, setWidths] = useState(loadWidths)
  const choose = (column: SortColumn): void => {
    const next = nextSort(sort, column)
    saveSort(next)
    setSort(next)
  }
  const resize: Resize = (column, width, next, nextWidth) => {
    const resized = resizeWidths(widths, column, width, next, nextWidth)
    saveWidths(resized)
    setWidths(resized)
  }
  if (!payload.automations.length) {
    return <p className="text-sm text-muted-foreground">No automations found.</p>
  }
  // Inline as well as on each switch's hover: a blocking warning is read before acting.
  const refused = listRefusal(payload.automations, machines)
  const columns = gridTemplate(widths)
  return (
    <MachinesContext value={machines}>
      <GridColumns value={columns}>
        <RefusalLine refused={refused} />
        <div className="overflow-x-auto rounded-md border border-border/50 bg-muted/20">
          <div className={TABLE_MIN}>
            <HeaderRow sort={sort} widths={widths} onSort={choose} onResize={resize} />
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
      </GridColumns>
    </MachinesContext>
  )
}
