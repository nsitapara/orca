import type { ActivityRun, AutomationSummary, ItemFields } from '../../shared/api-types'
import { homeOf } from '../../shared/api-types-env'
import { runStatusWord } from '../../shared/env-text'
import { money } from '../../shared/money'
import { paintRun } from '../../shared/run-views/paint'
import { foldStrip, stripOf } from '../../shared/run-views/strip'
import { clockTime, itemUrl, runStatusLabel } from '../pages/format'
import { jobCode } from './activity-groups'
import { envCleanup } from './env-lines'
import { RunStrip } from './RunStrip'
import { openRun } from './run-panel-state'

function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

// One run on Activity (spec §3): job tag, item (linked out), worktree, cost, state and its strip. The strip's chips and
// "Open run" open the run panel. A run whose automation isn't loaded shows no strip.
export function ActivityRunRow({
  run,
  fields,
  summary
}: {
  run: ActivityRun
  fields: ItemFields
  summary: AutomationSummary | undefined
}): React.JSX.Element {
  const url = itemUrl(fields)
  const home = homeOf(run)
  const cleanup = envCleanup(run)
  const items = summary ? foldStrip(stripOf(paintRun(summary.chain, { run }).parts)) : []
  return (
    <li className="flex flex-col gap-1 border-t border-border/50 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{clockTime(run.startedAt)}</span>
        <span className="rounded bg-muted px-1.5 text-foreground">
          {jobCode(summary?.name ?? run.automationId)}
        </span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-foreground underline-offset-2 hover:underline"
          >
            {run.itemLabel}
          </a>
        ) : (
          <span className="text-sm text-foreground">{run.itemLabel}</span>
        )}
        {home ? (
          <span className="font-mono" title={home}>
            {baseName(home)}
          </span>
        ) : null}
        {run.costUsd !== null ? <span>{money(run.costUsd)}</span> : null}
        <span className="rounded bg-muted px-1.5 text-foreground">
          {runStatusWord(run, runStatusLabel)}
        </span>
        <span className="flex-1" />
        <button type="button" className="underline" onClick={() => openRun(run.id)}>
          Open run
        </button>
      </div>
      {run.outcome ? <div className="text-xs text-muted-foreground">{run.outcome}</div> : null}
      {cleanup ? <div className="text-xs text-muted-foreground">{cleanup}</div> : null}
      {items.length > 0 ? (
        <RunStrip
          items={items}
          label={`Run ${run.id}`}
          onChip={(chip) => openRun(run.id, chip.part)}
        />
      ) : null}
    </li>
  )
}
