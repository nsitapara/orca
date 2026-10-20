import { cn } from '@/lib/utils'
import type { AgentUsage, UsageAutomationRow, UsageDashboard } from '../../../shared/api-types'
import { fmtTokens, money } from '../../../shared/money'
import { AGENT_BAR, AGENT_LABEL, AGENTS, shareText, sharePercent } from './usage-text'

const COLS =
  'grid grid-cols-[minmax(0,1fr)_3rem_8rem_8rem_5rem_7rem] items-center gap-3 px-3 text-sm'

function AgentCell({ usage }: { usage: AgentUsage }): React.JSX.Element {
  if (usage.tokens === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="tabular-nums">
      {money(usage.costUsd)}
      <span className="text-muted-foreground"> · {fmtTokens(usage.tokens)}</span>
    </span>
  )
}

// The row's share of the period's cost, split into its agents' parts.
function ShareBar({
  row,
  totalCost
}: {
  row: UsageAutomationRow
  totalCost: number | null
}): React.JSX.Element {
  const width = sharePercent(row.costUsd, totalCost)
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="flex h-full" style={{ width: `${width}%` }}>
          {AGENTS.map((agent) => (
            <span
              key={agent}
              className={cn('h-full', AGENT_BAR[agent])}
              style={{ width: `${sharePercent(row.byAgent[agent].costUsd, row.costUsd)}%` }}
            />
          ))}
        </span>
      </span>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {shareText(row.costUsd, totalCost)}
      </span>
    </span>
  )
}

export function AutomationUsageTable({
  payload,
  onOpen
}: {
  payload: UsageDashboard
  onOpen(automationId: string): void
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">By automation</h3>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {AGENTS.map((agent) => (
            <span key={agent} className="flex items-center gap-1">
              <span className={cn('size-2 rounded-full', AGENT_BAR[agent])} />
              {AGENT_LABEL[agent]}
            </span>
          ))}
        </span>
      </div>
      {payload.automations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No automation spent anything in this period.
        </p>
      ) : (
        <div
          role="table"
          aria-label="Usage by automation"
          className="rounded-lg border border-border"
        >
          <div
            role="row"
            className={cn(COLS, 'border-b border-border py-2 text-xs text-muted-foreground')}
          >
            <span role="columnheader">Automation</span>
            <span role="columnheader" className="text-right">
              Runs
            </span>
            <span role="columnheader">Claude</span>
            <span role="columnheader">Codex</span>
            <span role="columnheader" className="text-right">
              Cost
            </span>
            <span role="columnheader">Share</span>
          </div>
          {payload.automations.map((row) => (
            <div
              key={row.automationId}
              role="row"
              className={cn(COLS, 'border-b border-border py-2 last:border-b-0 hover:bg-accent')}
            >
              <span role="cell" className="min-w-0">
                <button
                  type="button"
                  className="max-w-full truncate text-left font-medium"
                  title={row.name}
                  onClick={() => onOpen(row.automationId)}
                >
                  {row.name}
                </button>
              </span>
              <span role="cell" className="text-right tabular-nums text-muted-foreground">
                {row.runs}
              </span>
              <span role="cell" className="truncate">
                <AgentCell usage={row.byAgent.claude} />
              </span>
              <span role="cell" className="truncate">
                <AgentCell usage={row.byAgent.codex} />
              </span>
              <span role="cell" className="text-right font-medium tabular-nums">
                {money(row.costUsd)}
              </span>
              <span role="cell">
                <ShareBar row={row} totalCost={payload.total.costUsd} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
