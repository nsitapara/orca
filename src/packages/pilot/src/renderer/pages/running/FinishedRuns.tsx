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
import { paintRun } from '../../../shared/run-views/paint'
import { runStrip } from '../../../shared/run-views/strip'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { useRunEffects } from '../../run-views/effects-feed'
import { EffectsLine } from '../../run-views/EffectsLine'
import { openRun } from '../../run-views/run-panel-state'
import { RunStrip } from '../../run-views/RunStrip'
import { canResume, ResumeButton } from '../../run-views/StepDetail'
import { RUN_TONE } from '../../run-views/tokens'
import { WaitingRow } from '../../timeline/WaitingRow'
import { clockTime, itemUrl, runStatusLabel } from '../format'
import { worktreeName } from '../waiting/answer-text'
import { openWorktree, repoNameForPath, worktreeIdForPath } from '../waiting/WorktreeLink'
import { endedText } from './running-text'

const CELL = 'py-1.5 pr-3'
const NUMBER = 'py-1.5 pr-3 text-xs tabular-nums text-muted-foreground'

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
        <button type="button" className="hover:underline" onClick={() => openWorktree(id)}>
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
      <tr className="border-t border-border/50">
        <td className="py-1 pl-2">
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
        <td className={NUMBER} title={new Date(ended).toLocaleString()}>
          {endedText(ended, now)}
        </td>
        <td className={cn(CELL, 'truncate font-medium')} title={run.automationName}>
          {run.automationName}
        </td>
        <td className={cn(CELL, 'truncate text-xs')}>
          <ItemCell run={run} />
        </td>
        <td className={cn(CELL, 'truncate text-xs')}>
          <WorktreeCell path={homeOf(run)} />
        </td>
        <td className={cn(CELL, 'text-xs')}>
          <span className={cn('rounded px-1.5 whitespace-nowrap', RUN_TONE[run.status])}>
            {runStatusWord(run, runStatusLabel)}
          </span>
        </td>
        <td className={cn(NUMBER, 'text-status-warning')}>
          {run.queuedAt ? formatDuration(run.startedAt - run.queuedAt) : ''}
        </td>
        <td className={NUMBER}>{formatDuration(ended - run.startedAt)}</td>
        <td className={NUMBER}>{run.peakBytes === null ? '–' : formatMemory(run.peakBytes)}</td>
        <td className={NUMBER}>{run.costUsd === null ? '–' : money(run.costUsd)}</td>
        <td className={cn(CELL, 'truncate text-xs')}>
          <SessionCell run={run} />
        </td>
        <td className="py-1.5 pr-3 text-right text-xs">
          <button type="button" className="underline" onClick={() => openRun(run.id)}>
            Open
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={12} className="pb-3 pl-10 pr-3">
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
            <table className="w-full min-w-240 table-fixed text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-9">
                    <span className="sr-only">Details</span>
                  </th>
                  <th className="w-24 py-1.5 pr-3 font-medium">Ended</th>
                  <th className="py-1.5 pr-3 font-medium">Job</th>
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  <th className="py-1.5 pr-3 font-medium">Worktree</th>
                  <th className="w-24 py-1.5 pr-3 font-medium">Result</th>
                  <th className="w-16 py-1.5 pr-3 font-medium">Waited</th>
                  <th className="w-16 py-1.5 pr-3 font-medium">Ran</th>
                  <th className="w-24 py-1.5 pr-3 font-medium">Peak memory</th>
                  <th className="w-16 py-1.5 pr-3 font-medium">Cost</th>
                  <th className="w-24 py-1.5 pr-3 font-medium">Session</th>
                  <th className="w-14">
                    <span className="sr-only">Run</span>
                  </th>
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
