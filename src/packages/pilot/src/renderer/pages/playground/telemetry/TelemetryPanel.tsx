import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  isTelemetryWindow,
  type TelemetryFailures as Failures,
  type TelemetryUsage,
  type TelemetryWindow
} from '../../../../shared/api-types-telemetry'
import { Select } from '../../waiting/InboxHeader'
import { BAR_SWATCH, DayBars } from './telemetry-charts'
import {
  badClass,
  clockText,
  dayText,
  SECTION_CLASS,
  SECTION_HEAD_CLASS,
  totalsOf,
  windowText
} from './telemetry-view'
import { TelemetryCommands } from './TelemetryCommands'
import { TelemetryFailures } from './TelemetryFailures'
import { TelemetryJobs } from './TelemetryJobs'
import { useTelemetry, type TelemetryShown } from './use-telemetry'

const READING = "Reading pilotcli's telemetry…"
const WINDOWS: { id: TelemetryWindow; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days (all kept)' }
]

function TelemetryHeader({
  since,
  onSince,
  includeDev,
  onDev,
  fetchedAt,
  staleBecause,
  loading,
  onRefresh
}: {
  since: TelemetryWindow
  onSince: (since: TelemetryWindow) => void
  includeDev: boolean
  onDev: (on: boolean) => void
  fetchedAt: number | null
  staleBecause: string | null
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const updated = fetchedAt === null ? 'This Mac' : `This Mac · updated ${clockText(fetchedAt)}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Window"
        prefix="Window"
        value={since}
        onChange={(v) => isTelemetryWindow(v) && onSince(v)}
      >
        {WINDOWS.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label}
          </option>
        ))}
      </Select>
      <label
        className="inline-flex items-center gap-1.5 text-[13px]"
        title="Count calls from a dev pilotcli binary (a worktree's build) too"
      >
        <input
          type="checkbox"
          aria-label="Dev calls"
          checked={includeDev}
          onChange={(e) => onDev(e.target.checked)}
        />
        Dev calls
      </label>
      <Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
        Refresh
      </Button>
      <span className="text-xs text-muted-foreground">{updated}</span>
      {staleBecause ? (
        <span className="text-xs text-destructive">{`Couldn't refresh: ${staleBecause}`}</span>
      ) : null}
    </div>
  )
}

function Tiles({
  usage,
  since
}: {
  usage: TelemetryUsage
  since: TelemetryWindow
}): React.JSX.Element {
  const totals = totalsOf(usage)
  const tiles = [
    { label: `calls in ${windowText(since)}`, value: usage.calls, tone: '' },
    { label: 'failed', value: totals.failed, tone: badClass('failed', totals.failed) },
    {
      label: 'invalid (refused, nothing attempted)',
      value: totals.invalid,
      tone: badClass('invalid', totals.invalid)
    },
    { label: 'commands never called', value: usage.unused.length, tone: '' },
    { label: 'dev-binary calls left out', value: usage.left_out.dev, tone: 'text-muted-foreground' }
  ]
  return (
    <ul aria-label="Totals" className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
      {tiles.map((t) => (
        <li
          key={t.label}
          className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/50 px-4 py-3"
        >
          <div className={`font-mono text-2xl font-semibold tabular-nums ${t.tone}`}>
            {t.value.toLocaleString('en-US')}
          </div>
          <div className="text-xs text-muted-foreground">{t.label}</div>
        </li>
      ))}
    </ul>
  )
}

const LEGEND: { kind: keyof typeof BAR_SWATCH; label: string }[] = [
  { kind: 'rest', label: 'ok or skip' },
  { kind: 'failed', label: 'failed' },
  { kind: 'invalid', label: 'invalid' }
]

function Legend({ oldest }: { oldest: string | undefined }): React.JSX.Element {
  const since = oldest ? `Data since ${dayText(oldest)} · kept 90 days` : 'Kept 90 days'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map((l) => (
        <span key={l.kind} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`inline-block size-2.5 rounded-sm ${BAR_SWATCH[l.kind]}`} />
          {l.label}
        </span>
      ))}
      <span>{since}</span>
    </div>
  )
}

// The bars with their legend, or why there are none: a pilotcli from before 2026-10-17 sends no per-day counts.
function PerDay({ usage }: { usage: TelemetryUsage }): React.JSX.Element {
  const { buckets, series } = usage
  const charted = buckets?.length && series ? { buckets, series } : null
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <h3 className="text-sm font-semibold">Calls per day</h3>
        {charted ? <Legend oldest={usage.oldest} /> : null}
      </div>
      <div className="px-4">
        {charted ? (
          <DayBars buckets={charted.buckets} series={charted.series} />
        ) : (
          <p className="text-xs text-muted-foreground">Per-day counts need a newer pilotcli.</p>
        )}
      </div>
    </section>
  )
}

// `picked` is the command clicked now; `failuresFor` the one the failures shown were read for.
function Usage({
  usage,
  failures,
  since,
  picked,
  failuresFor,
  onPick,
  onTryIt,
  onClear
}: {
  usage: TelemetryUsage
  failures: Failures
  since: TelemetryWindow
  picked: string | null
  failuresFor: string | null
  onPick: (command: string) => void
  onTryIt?: (command: string) => void
  onClear: () => void
}): React.JSX.Element {
  const names = new Map(usage.jobs.map((j) => [j.automation, j.name]))
  return (
    <>
      <Tiles usage={usage} since={since} />
      <PerDay usage={usage} />
      <TelemetryCommands usage={usage} since={since} picked={picked} onPick={onPick} />
      {/* Side by side only when each gets 46rem: the failures table needs it for Command and Who · where. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,46rem),1fr))] gap-3">
        <TelemetryJobs jobs={usage.jobs} />
        <TelemetryFailures
          failures={failures}
          since={since}
          command={failuresFor}
          now={new Date(usage.to)}
          names={names}
          onTryIt={onTryIt}
          onClear={onClear}
        />
      </div>
    </>
  )
}

function NoCalls({
  usage,
  since
}: {
  usage: TelemetryUsage
  since: TelemetryWindow
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>{`No calls in ${windowText(since)}.`}</p>
      {usage.left_out.dev > 0 ? (
        <p className="text-xs">{`${usage.left_out.dev} dev-binary calls left out: tick Dev calls to count them.`}</p>
      ) : null}
    </div>
  )
}

// Before any data: reading, or why the read failed. With data, a later failure sits in the header beside it.
function TelemetryBody({
  shown,
  error,
  picked,
  onPick,
  onTryIt,
  onClear
}: {
  shown: TelemetryShown | null
  error: string | null
  picked: string | null
  onPick: (command: string) => void
  onTryIt?: (command: string) => void
  onClear: () => void
}): React.JSX.Element {
  if (shown === null && error !== null) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (shown === null) {
    return <p className="text-sm text-muted-foreground">{READING}</p>
  }
  const { payload, ask } = shown
  if (payload.usage.calls === 0) {
    return <NoCalls usage={payload.usage} since={ask.since} />
  }
  return (
    <Usage
      usage={payload.usage}
      failures={payload.failures}
      since={ask.since}
      picked={picked}
      failuresFor={ask.command}
      onPick={onPick}
      onTryIt={onTryIt}
      onClear={onClear}
    />
  )
}

// pilotcli's telemetry on this Mac: which commands get called, by whom, and how they fail. Pilot reads it through
// pilotcli (pilot.telemetry.get), never the file, and shows its values as text only.
export function TelemetryPanel({
  active = true,
  onTryIt
}: {
  active?: boolean
  onTryIt?: (command: string) => void
}): React.JSX.Element {
  const [since, setSince] = useState<TelemetryWindow>('7d')
  const [includeDev, setIncludeDev] = useState(false)
  const [command, setCommand] = useState<string | null>(null)
  const { shown, error, loading, refresh } = useTelemetry({ since, includeDev, command, active })
  const pick = (next: string): void => setCommand((was) => (was === next ? null : next))
  return (
    <div className="flex flex-col gap-3 pb-4">
      <TelemetryHeader
        since={since}
        onSince={setSince}
        includeDev={includeDev}
        onDev={setIncludeDev}
        fetchedAt={shown?.payload.fetchedAt ?? null}
        staleBecause={shown ? error : null}
        loading={loading}
        onRefresh={refresh}
      />
      <TelemetryBody
        shown={shown}
        error={error}
        picked={command}
        onPick={pick}
        onTryIt={onTryIt}
        onClear={() => setCommand(null)}
      />
    </div>
  )
}
