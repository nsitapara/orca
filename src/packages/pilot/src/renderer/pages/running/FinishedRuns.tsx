import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { FinishedRun } from '../../../shared/api-types-capacity'
import { checkoutRemoved, homeOf } from '../../../shared/api-types-env'
import { formatMemory } from '../../../shared/capacity/format-memory'
import { runStatusWord } from '../../../shared/env-text'
import { money } from '../../../shared/money'
import { formatDuration } from '../../../shared/run/format-duration'
import { workedMs } from '../../../shared/run/worked-time'
import { paintRun } from '../../../shared/run-views/paint'
import { runStrip } from '../../../shared/run-views/strip'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { useRunEffects } from '../../run-views/effects-feed'
import { EffectsLine } from '../../run-views/EffectsLine'
import { openRun } from '../../run-views/run-panel-state'
import { RunStrip } from '../../run-views/RunStrip'
import { canResume, ResumeButton } from '../../run-views/StepDetail'
import { runTone } from '../../run-views/tokens'
import { WaitingRow } from '../../timeline/WaitingRow'
import { clockTime, itemUrl, runStatusLabel } from '../format'
import { worktreeName } from '../waiting/answer-text'
import { openWorktree, repoNameForPath, worktreeIdForPath } from '../waiting/WorktreeLink'
import { ResizableHeaderCell } from '../ResizableHeaderCell'
import { useColumnWidths, type ColumnSpec } from '../use-column-widths'
import { endedText } from './running-text'

// Widths are remembered per viewer, by column id.
export const FINISHED_WIDTHS_KEY = 'pilot.running.finished.widths'

const RESULT: ColumnSpec = { id: 'result', label: 'Result', defaultWidth: 96, minWidth: 96 }
const JOB: ColumnSpec = { id: 'job', label: 'Job', defaultWidth: 144, minWidth: 96 }
const ITEM: ColumnSpec = { id: 'item', label: 'Item', defaultWidth: 160, minWidth: 96 }
const WORKTREE: ColumnSpec = { id: 'worktree', label: 'Worktree', defaultWidth: 176, minWidth: 112 }
const WAITED: ColumnSpec = { id: 'waited', label: 'Waited', defaultWidth: 72, minWidth: 64 }
const RAN: ColumnSpec = { id: 'ran', label: 'Ran', defaultWidth: 56, minWidth: 56 }
const PEAK: ColumnSpec = { id: 'peak', label: 'Peak memory', defaultWidth: 104, minWidth: 104 }
const COST: ColumnSpec = { id: 'cost', label: 'Cost', defaultWidth: 64, minWidth: 64 }
const SESSION: ColumnSpec = { id: 'session', label: 'Session', defaultWidth: 96, minWidth: 88 }
const ENDED: ColumnSpec = { id: 'ended', label: 'Ended', defaultWidth: 128, minWidth: 80 }

// The row toggle and Open keep their width; their headers are for screen readers.
type FixedColumn = { id: string; label: string; width: number }
const TOGGLE: FixedColumn = { id: 'toggle', label: 'Details', width: 36 }
const OPEN: FixedColumn = { id: 'open', label: 'Run', width: 56 }

// Result leads and Ended closes; FinishedRow's cells follow this order.
const COLUMNS: (ColumnSpec | FixedColumn)[] = [
  TOGGLE,
  RESULT,
  JOB,
  ITEM,
  WORKTREE,
  WAITED,
  RAN,
  PEAK,
  COST,
  SESSION,
  OPEN,
  ENDED
]

function isFixed(col: ColumnSpec | FixedColumn): col is FixedColumn {
  return 'width' in col
}

// Cells wrap rather than cut text off; a narrow column grows taller.
const CELL = 'break-words px-3 py-1.5'
const NUMBER = 'px-3 py-1.5 tabular-nums text-muted-foreground'

function ItemCell({ run }: { run: FinishedRun }): React.JSX.Element {
  const url = itemUrl(run.fields)
  if (!url) {
    return <span title={run.itemLabel}>{run.itemLabel}</span>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={run.itemLabel}
      className="underline-offset-2 hover:underline"
    >
      {run.itemLabel}
    </a>
  )
}

// The worktree the run worked in and the project the app lists it under; the name opens it when the app has it.
function WorktreeCell({ path }: { path: string | null }): React.JSX.Element {
  if (!path) {
    return <span className="text-muted-foreground">–</span>
  }
  const id = worktreeIdForPath(path)
  const project = repoNameForPath(path)
  const name = <span className="font-mono">{worktreeName(path)}</span>
  return (
    <span title={path}>
      {id ? (
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => openWorktree(id)}
        >
          {name}
        </button>
      ) : (
        name
      )}
      {project ? <span className="ml-1.5 text-muted-foreground">{project}</span> : null}
    </span>
  )
}

// Resume reopens the run's newest agent session; none once a throwaway checkout is gone.
function SessionCell({ run }: { run: FinishedRun }): React.JSX.Element {
  const step = run.steps.findLast(canResume)
  if (!step || checkoutRemoved(run)) {
    return <span className="text-muted-foreground">–</span>
  }
  return <ResumeButton runId={run.id} worktreePath={run.worktreePath} step={step} />
}

// What a row opens to: how it ended, what it changed, the cards it made and its steps (each opens its log).
function FinishedDetails({ run }: { run: FinishedRun }): React.JSX.Element {
  const effects = useRunEffects(run.id, false)
  const summary = useAutomationsFeed().byId.get(run.automationId)
  const chips = summary ? runStrip(paintRun(summary.chain, { run }).parts, run) : []
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {run.outcome ? <div className="text-sm text-foreground">{run.outcome}</div> : null}
      <EffectsLine effects={effects} />
      {run.inbox.map((item) => (
        <WaitingRow key={item.id} item={item} />
      ))}
      {chips.length > 0 ? (
        <RunStrip
          items={chips}
          label={`Run ${run.id}`}
          onChip={(chip) => openRun(run.id, chip.part)}
        />
      ) : null}
      <div>Started {clockTime(run.startedAt)}</div>
    </div>
  )
}

function FinishedRow({
  run,
  now,
  open,
  onToggle
}: {
  run: FinishedRun
  now: number
  open: boolean
  onToggle(): void
}): React.JSX.Element {
  const ended = run.finishedAt ?? now
  return (
    <>
      <tr className="border-t border-border/50 align-top">
        <td className="py-0.5 pl-2">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} details of ${run.automationName}`}
            onClick={onToggle}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        </td>
        <td className={CELL}>
          <span className={cn('rounded px-1.5', runTone(run))}>
            {runStatusWord(run, runStatusLabel)}
          </span>
        </td>
        <td className={cn(CELL, 'font-medium')}>{run.automationName}</td>
        <td className={CELL}>
          <ItemCell run={run} />
        </td>
        <td className={CELL}>
          <WorktreeCell path={homeOf(run)} />
        </td>
        <td className={cn(NUMBER, 'text-status-warning')}>
          {run.queuedAt ? formatDuration(run.startedAt - run.queuedAt) : ''}
        </td>
        <td className={NUMBER}>{formatDuration(workedMs(run, ended))}</td>
        <td className={NUMBER}>{run.peakBytes === null ? '–' : formatMemory(run.peakBytes)}</td>
        <td className={NUMBER}>{run.costUsd === null ? '–' : money(run.costUsd)}</td>
        <td className={CELL}>
          <SessionCell run={run} />
        </td>
        <td className="px-3 py-1.5">
          <button type="button" className="underline" onClick={() => openRun(run.id)}>
            Open
          </button>
        </td>
        <td className={NUMBER} title={new Date(ended).toLocaleString()}>
          {endedText(ended, now)}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={COLUMNS.length} className="pb-3 pl-10 pr-3">
            <FinishedDetails run={run} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

// The slot-holding jobs' newest ended runs (main/capacity), folded until asked for; a row opens to its details.
export function FinishedRuns({
  runs,
  now
}: {
  runs: FinishedRun[]
  now: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const columns = useColumnWidths(FINISHED_WIDTHS_KEY)
  const widthOf = (col: ColumnSpec | FixedColumn): number =>
    isFixed(col) ? col.width : columns.widthOf(col)
  const total = COLUMNS.reduce((sum, col) => sum + widthOf(col), 0)
  return (
    <Collapsible open={open} onOpenChange={setOpen} role="region" aria-label="Recently finished">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
          />
          Recently finished · {runs.length}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {runs.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing has finished yet.</p>
        ) : (
          <div className="mt-1 overflow-x-auto rounded-lg border border-border/50">
            <table className="text-left text-xs" style={{ tableLayout: 'fixed', width: total }}>
              <colgroup>
                {COLUMNS.map((col) => (
                  <col key={col.id} style={{ width: widthOf(col) }} />
                ))}
              </colgroup>
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  {COLUMNS.map((col) =>
                    isFixed(col) ? (
                      <th key={col.id}>
                        <span className="sr-only">{col.label}</span>
                      </th>
                    ) : (
                      <ResizableHeaderCell key={col.id} col={col} columns={columns} />
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <FinishedRow
                    key={run.id}
                    run={run}
                    now={now}
                    open={expanded === run.id}
                    onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
