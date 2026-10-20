import { Progress } from '@/components/ui/progress'
import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../../../../../shared/rate-limit-types'
import type { UsageSinceReset } from '../../../shared/api-types'
import type { AgentKind } from '../../../shared/definition/types'
import { fmtTokens, money } from '../../../shared/money'
import { AGENT_LABEL, AGENTS, dayLabel, resetText, shareText } from './usage-text'

// The automations that spent the most since the weekly reset; the rest are in the table below.
const SINCE_RESET_SHOWN = 5

function LimitMeter({
  label,
  window
}: {
  label: string
  window: RateLimitWindow | null
}): React.JSX.Element {
  if (!window) {
    return (
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span>Not reported</span>
      </div>
    )
  }
  const used = Math.round(window.usedPercent)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-medium text-foreground">{used}% used</span>
          <span className="text-muted-foreground"> · {resetText(window)}</span>
        </span>
      </div>
      <Progress value={Math.min(100, window.usedPercent)} aria-label={`${label}: ${used}% used`} />
    </div>
  )
}

function SinceReset({ since }: { since: UsageSinceReset }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
      <p className="text-xs text-muted-foreground">
        Automations since the reset on {dayLabel(since.sinceDay)}: {money(since.total.costUsd)} ·{' '}
        {fmtTokens(since.total.tokens)} tokens
      </p>
      {since.automations.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ol className="flex flex-col gap-0.5" aria-label="Automations since the reset">
          {since.automations.slice(0, SINCE_RESET_SHOWN).map((a) => (
            <li key={a.automationId} className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={a.name}>
                {a.name}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmtTokens(a.tokens)}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">{money(a.costUsd)}</span>
              <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
                {shareText(a.costUsd, since.total.costUsd)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function QuotaCard({
  agent,
  limits,
  since
}: {
  agent: AgentKind
  limits: ProviderRateLimits | null
  since: UsageSinceReset | undefined
}): React.JSX.Element {
  return (
    <section
      aria-label={`${AGENT_LABEL[agent]} limits`}
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{AGENT_LABEL[agent]}</h3>
        {limits?.planType ? (
          <span className="text-xs text-muted-foreground">{limits.planType}</span>
        ) : null}
      </div>
      {limits?.status === 'error' && limits.error ? (
        <p className="text-xs text-destructive">{limits.error}</p>
      ) : null}
      <LimitMeter label="This week" window={limits?.weekly ?? null} />
      <LimitMeter label="5-hour session" window={limits?.session ?? null} />
      {since ? <SinceReset since={since} /> : null}
    </section>
  )
}

// Each agent's limits as Orca last read them, and what the automations spent since its weekly reset.
export function QuotaCards({
  limits,
  sinceReset
}: {
  limits: RateLimitState
  sinceReset: Partial<Record<AgentKind, UsageSinceReset>>
}): React.JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {AGENTS.map((agent) => (
        <QuotaCard key={agent} agent={agent} limits={limits[agent]} since={sinceReset[agent]} />
      ))}
    </div>
  )
}
