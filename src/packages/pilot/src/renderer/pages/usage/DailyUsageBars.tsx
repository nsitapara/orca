import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { UsageDayRow } from '../../../shared/api-types'
import { fmtTokens, money } from '../../../shared/money'
import { AGENT_BAR, AGENT_LABEL, AGENTS, dayLabel, sharePercent } from './usage-text'

function dayCost(day: UsageDayRow): number {
  return AGENTS.reduce((sum, agent) => sum + (day.byAgent[agent].costUsd ?? 0), 0)
}

// One column per day, its height the day's cost against the costliest day, split by agent.
export function DailyUsageBars({ daily }: { daily: readonly UsageDayRow[] }): React.JSX.Element {
  const most = Math.max(0, ...daily.map(dayCost))
  const first = daily.at(0)
  const last = daily.at(-1)
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">By day</h3>
      <TooltipProvider delayDuration={100}>
        <div
          role="list"
          aria-label="Cost by day"
          className="flex h-36 items-end gap-1 rounded-lg border border-border px-3 pb-2 pt-3"
        >
          {daily.map((day) => {
            const cost = dayCost(day)
            return (
              <Tooltip key={day.day}>
                <TooltipTrigger asChild>
                  <div
                    role="listitem"
                    aria-label={`${dayLabel(day.day)}: ${money(cost)}`}
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  >
                    <div
                      className="flex flex-col-reverse overflow-hidden rounded-sm"
                      style={{ height: `${sharePercent(cost, most)}%` }}
                    >
                      {AGENTS.map((agent) => (
                        <div
                          key={agent}
                          className={cn('w-full', AGENT_BAR[agent])}
                          style={{
                            height: `${sharePercent(day.byAgent[agent].costUsd, cost)}%`
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="font-medium">
                    {dayLabel(day.day)} · {money(cost)}
                  </p>
                  {AGENTS.map((agent) => (
                    <p key={agent}>
                      {AGENT_LABEL[agent]}: {money(day.byAgent[agent].costUsd)} ·{' '}
                      {fmtTokens(day.byAgent[agent].tokens)} tokens
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{first ? dayLabel(first.day) : ''}</span>
        <span>{last ? dayLabel(last.day) : ''}</span>
      </div>
    </section>
  )
}
