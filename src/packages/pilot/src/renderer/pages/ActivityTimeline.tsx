import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ActivityTick, RunRow, TickItemRow } from '../../shared/api-types'
import { tickLine, verdictLabel } from './format'

function CheckCell({ item, name }: { item: TickItemRow; name: string }): React.JSX.Element {
  const c = item.checks.find((x) => x.check === name)
  if (!c) {
    return <td className="px-3 py-2 text-muted-foreground">—</td>
  }
  if (c.ok) {
    return <td className="px-3 py-2 text-emerald-600">✓</td>
  }
  return <td className="px-3 py-2 text-orange-600">{`✗ ${c.reason}`}</td>
}

function CheckTable({
  items,
  checkNames
}: {
  items: TickItemRow[]
  checkNames: string[]
}): React.JSX.Element {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border/50 bg-muted/20">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Item</th>
            {checkNames.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemKey} className="border-t border-border/50 align-top">
              <td className="px-3 py-2 font-medium">{item.label}</td>
              {checkNames.map((name) => (
                <CheckCell key={name} item={item} name={name} />
              ))}
              <td className="px-3 py-2">
                <div>{verdictLabel(item.verdict)}</div>
                <div className="text-xs text-muted-foreground">{item.reason}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function costText(run: RunRow): string {
  return run.costUsd === null ? '' : ` · $${run.costUsd.toFixed(2)}`
}

function RunLine({ run }: { run: RunRow }): React.JSX.Element {
  return (
    <li className="text-sm">
      <div>{`Run ${run.id} · ${run.itemLabel} · ${run.status}${costText(run)}`}</div>
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
