import type { UsageRunRow } from '../../../shared/api-types'
import { fmtTokens, money } from '../../../shared/money'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { openRun } from '../../run-views/run-panel-state'
import { AGENT_LABEL, AGENTS, whenText } from './usage-text'

// "Claude $2.10 · Codex $0.40": only the agents the run used.
function agentsText(run: UsageRunRow): string {
  return AGENTS.filter((agent) => run.byAgent[agent].tokens > 0)
    .map((agent) => `${AGENT_LABEL[agent]} ${money(run.byAgent[agent].costUsd)}`)
    .join(' · ')
}

export function TopRuns({
  runs,
  now
}: {
  runs: readonly UsageRunRow[]
  now: number
}): React.JSX.Element | null {
  const host = usePilotHost()
  if (runs.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Costliest runs</h3>
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {runs.map((run) => (
          <li key={run.runId} className="flex min-w-0 flex-col gap-0.5 px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium" title={run.name}>
                {run.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {whenText(run.startedAt, now)}
              </span>
              <span className="ml-auto shrink-0 pl-2 tabular-nums">
                {money(run.costUsd)}
                <span className="text-muted-foreground"> · {fmtTokens(run.tokens)}</span>
              </span>
              <button
                type="button"
                className="shrink-0 text-xs underline"
                onClick={() => openRun(run.runId, null, host)}
              >
                Open run
              </button>
            </div>
            <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate font-mono" title={run.itemLabel}>
                {run.itemLabel}
              </span>
              <span className="ml-auto shrink-0">{agentsText(run)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
