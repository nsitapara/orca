import { useEffect, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { UsageDashboard } from '../../../shared/api-types'
import { fmtTokens, money } from '../../../shared/money'
import { relativeTime } from '../../../shared/relative-time'
import { useHostPoll, type HostRead } from '../../hosts/host-poll'
import { PilotHostProvider } from '../../hosts/PilotHostContext'
import { setPilotAutomationsView, setPilotOpenAutomation } from '../automations-view'
import { AutomationUsageTable } from './AutomationUsageTable'
import { DailyUsageBars } from './DailyUsageBars'
import { QuotaCards } from './QuotaCards'
import { TopRuns } from './TopRuns'
import { AGENT_LABEL, periodLabel, resetDaysOf, USAGE_PERIODS } from './usage-text'

// A step's usage lands within a poll of its end; a minute keeps the page current without re-reading every log.
export const USAGE_POLL_MS = 60_000
const DEFAULT_DAYS = 7

function openAutomation(id: string): void {
  setPilotAutomationsView('automations')
  setPilotOpenAutomation(id)
}

// The machine picked, else this one, else the first that answered.
function shownRead(
  reads: readonly HostRead<UsageDashboard>[],
  key: string | null
): HostRead<UsageDashboard> | null {
  return (
    reads.find((r) => r.host.key === key) ?? reads.find((r) => r.host.local) ?? reads[0] ?? null
  )
}

function Tile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Totals({ payload }: { payload: UsageDashboard }): React.JSX.Element {
  const { total } = payload
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label={`Cost · ${periodLabel(payload.days)}`} value={money(total.costUsd)} />
      <Tile label="Tokens" value={fmtTokens(total.tokens)} />
      <Tile label="Runs" value={String(total.runs)} />
      <Tile
        label={`${AGENT_LABEL.claude} · ${AGENT_LABEL.codex}`}
        value={`${money(total.byAgent.claude.costUsd)} · ${money(total.byAgent.codex.costUsd)}`}
      />
    </dl>
  )
}

function MachineChips({
  reads,
  shown,
  onPick
}: {
  reads: readonly HostRead<UsageDashboard>[]
  shown: string | null
  onPick(key: string): void
}): React.JSX.Element | null {
  if (reads.length < 2) {
    return null
  }
  return (
    <div role="group" aria-label="Machine shown" className="flex flex-wrap gap-1">
      {reads.map((r) => (
        <button
          key={r.host.key}
          type="button"
          aria-pressed={r.host.key === shown}
          onClick={() => onPick(r.host.key)}
          className={cn(
            'rounded border px-2 text-xs leading-6',
            r.host.key === shown
              ? 'border-foreground text-foreground'
              : 'border-border text-muted-foreground'
          )}
        >
          {r.host.machineName}
        </button>
      ))}
    </div>
  )
}

function Footnote({ payload, now }: { payload: UsageDashboard; now: number }): React.JSX.Element {
  const pending =
    payload.pendingSteps > 0
      ? ` ${payload.pendingSteps} agent step${payload.pendingSteps === 1 ? '' : 's'} still to measure.`
      : ''
  const measured = payload.measuredAt
    ? ` Last measured ${relativeTime(payload.measuredAt, now)}.`
    : ''
  return (
    <p className="text-xs text-muted-foreground">
      Read from the agents&apos; own logs when each step ends, with the sessions its agent started
      and its subagents. Cost is what these tokens would cost on the API, not what your plans bill.
      {pending}
      {measured}
    </p>
  )
}

// What each automation spent (spec: Usage beside Activity): the agents' limits, then the period's spend by automation,
// by day and by run.
export function UsagePage(): React.JSX.Element {
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [hostKey, setHostKey] = useState<string | null>(null)
  const limits = useAppStore((s) => s.rateLimits)
  useEffect(() => {
    void useAppStore.getState().fetchRateLimits()
  }, [])
  const { reads } = useHostPoll<UsageDashboard>(
    'pilot.usage.dashboard',
    { days, resetDays: resetDaysOf(limits) },
    USAGE_POLL_MS,
    { skipHidden: true }
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setNow(Date.now()), [reads])
  const read = shownRead(reads, hostKey)
  const payload = read?.value ?? null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="text-muted-foreground"
          onClick={() => setPilotAutomationsView('automations')}
        >
          Automations
        </button>
        <span className="text-muted-foreground">›</span>
        <span>Usage</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Usage</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Period"
          value={String(days)}
          onValueChange={(value) => {
            if (value) {
              setDays(Number(value))
            }
          }}
        >
          {USAGE_PERIODS.map((p) => (
            <ToggleGroupItem key={p.days} value={String(p.days)}>
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <MachineChips reads={reads} shown={read?.host.key ?? null} onPick={setHostKey} />
      <QuotaCards limits={limits} sinceReset={payload?.sinceReset ?? {}} />
      {read?.error ? <p className="text-sm text-destructive">{read.error}</p> : null}
      {!payload && !read?.error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {payload && read ? (
        <PilotHostProvider host={read.host}>
          <Totals payload={payload} />
          <AutomationUsageTable payload={payload} onOpen={openAutomation} />
          {payload.daily.length > 1 ? <DailyUsageBars daily={payload.daily} /> : null}
          <TopRuns runs={payload.topRuns} now={now} />
          <Footnote payload={payload} now={now} />
        </PilotHostProvider>
      ) : null}
    </div>
  )
}
