import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ActivityTick, RunRow } from '../../shared/api-types'
import { CheckTable } from './CheckTable'
import { runStatusLabel, tickLine } from './format'

function costText(run: RunRow): string {
  return run.costUsd === null ? '' : ` · $${run.costUsd.toFixed(2)}`
}

function RunLine({ run }: { run: RunRow }): React.JSX.Element {
  return (
    <li className="text-sm">
      <div>{`Run ${run.id} · ${run.itemLabel} · ${runStatusLabel(run.status)}${costText(run)}`}</div>
      {run.outcome ? <div className="text-muted-foreground">{run.outcome}</div> : null}
    </li>
  )
}

function TickNode({
  tick,
  checkNames
}: {
  tick: ActivityTick
  checkNames: string[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const checked = tick.items.filter((i) => i.verdict !== 'out_of_scope').length
  return (
    <li className="relative border-l border-border pb-4 pl-5">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{new Date(tick.startedAt).toLocaleString()}</span>
        {tick.dryRun ? (
          <Badge variant="secondary">Dry run</Badge>
        ) : (
          <span>{`Tick ${tick.id}`}</span>
        )}
      </div>
      <div className="text-sm">{tickLine(tick)}</div>
      {tick.items.length ? (
        <button type="button" className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>
          {open ? 'Hide checks' : `Why: ${checked} items checked`}
        </button>
      ) : null}
      {open ? <CheckTable items={tick.items} checkNames={checkNames} /> : null}
      <ul className="mt-2 space-y-1">
        {tick.runs.map((run) => (
          <RunLine key={run.id} run={run} />
        ))}
      </ul>
    </li>
  )
}

// Ticks arrive newest first from pilot.automations.activity.
export function ActivityTimeline({
  ticks,
  checkNames
}: {
  ticks: ActivityTick[]
  checkNames: string[]
}): React.JSX.Element {
  if (!ticks.length) {
    return <p className="text-sm text-muted-foreground">No ticks yet.</p>
  }
  return (
    <ol className="ml-1">
      {ticks.map((t) => (
        <TickNode key={t.id} tick={t} checkNames={checkNames} />
      ))}
    </ol>
  )
}
