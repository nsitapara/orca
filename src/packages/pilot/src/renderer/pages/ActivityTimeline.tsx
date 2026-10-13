import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ActivityTick } from '../../shared/api-types'
import { RunCard } from '../timeline/RunCard'
import { CheckTable } from './CheckTable'
import { checkedItems, tickLine } from './format'

function TickNode({
  tick,
  checkNames
}: {
  tick: ActivityTick
  checkNames: string[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const checked = checkedItems(tick.items)
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
      {checked.length ? (
        <button type="button" className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>
          {open ? 'Hide checks' : `Why: ${checked.length} items checked`}
        </button>
      ) : null}
      {open && checked.length ? <CheckTable items={checked} checkNames={checkNames} /> : null}
      <ol className="mt-2">
        {tick.runs.map((run) => (
          <RunCard key={run.id} run={run} title={`Run ${run.id} · ${run.itemLabel}`} />
        ))}
      </ol>
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
