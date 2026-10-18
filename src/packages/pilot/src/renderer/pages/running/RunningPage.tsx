import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  CapacityPayload,
  CapacityRun,
  QueuedRun,
  RetryKey
} from '../../../shared/api-types-capacity'
import { formatDuration } from '../../../shared/run/format-duration'
import { workedMs } from '../../../shared/run/worked-time'
import { PilotHostProvider, usePilotHost } from '../../hosts/PilotHostContext'
import { openRun } from '../../run-views/run-panel-state'
import { useNow } from '../waiting/use-now'
import { FinishedRuns } from './FinishedRuns'
import { RunLimitPicker } from './LimitPickers'
import { GaveUpRow, RetryPanel } from './Retries'
import {
  memoryText,
  quotaText,
  runMemoryText,
  suggestionText,
  usageText,
  waitsForSlot
} from './running-text'
import { useCapacities, type CapacityChanges, type MachineCapacity } from './use-capacity'

// A machine's changes, bound to it.
type Changes = {
  onLimit(limit: number | null): void
  onRetryLimit(limit: number): void
  onRetry(key: RetryKey): void
}

function LimitPanel({
  payload,
  where,
  saving,
  onChange,
  onRetryLimit
}: {
  payload: CapacityPayload
  where: string
  saving: boolean
  onChange(limit: number | null): void
  onRetryLimit(limit: number): void
}): React.JSX.Element {
  const suggested = payload.suggestion.limit
  const memory = memoryText(payload)
  return (
    <section
      aria-label="Run limit"
      className="flex flex-col gap-3 rounded-lg border border-border/50 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Jobs at once</div>
          <p className="text-xs text-muted-foreground">
            Counts jobs with an agent step. Past it, jobs wait in line, oldest first; changing it
            stops nothing that is running.
          </p>
        </div>
        <RunLimitPicker limit={payload.limit} disabled={saving} onChange={onChange} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-3">
        <span className="text-sm">
          Suggested: <span className="font-medium tabular-nums">{suggested}</span>
        </span>
        {payload.limit === suggested ? null : (
          <Button variant="outline" size="xs" disabled={saving} onClick={() => onChange(suggested)}>
            Use {suggested}
          </Button>
        )}
        {memory ? <p className="basis-full text-xs tabular-nums">{memory}</p> : null}
        <p className="basis-full text-xs text-muted-foreground">
          {suggestionText(payload)} Memory counts each job&apos;s processes on {where}, not
          Docker&apos;s containers.
        </p>
        {payload.quotaCeiling ? (
          <p className="basis-full text-xs text-muted-foreground">
            {quotaText(payload.quotaCeiling)}
          </p>
        ) : null}
      </div>
      <RetryPanel payload={payload} saving={saving} onChange={onRetryLimit} />
    </section>
  )
}

function RunningRow({ run, now }: { run: CapacityRun; now: number }): React.JSX.Element {
  const host = usePilotHost()
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <span className="shrink-0 font-medium">{run.automationName}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        title={run.itemLabel}
      >
        {run.itemLabel}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(workedMs(run, now))}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {runMemoryText(run)}
      </span>
      <button
        type="button"
        className="shrink-0 text-xs underline"
        onClick={() => openRun(run.id, null, host)}
      >
        Open run
      </button>
    </li>
  )
}

// 1-based place among the slot waiters, in line order; null for a held item.
function placeInLine(queued: readonly QueuedRun[], item: QueuedRun): number | null {
  if (!waitsForSlot(item)) {
    return null
  }
  return queued.filter(waitsForSlot).indexOf(item) + 1
}

function QueuedRow({
  item,
  place,
  now
}: {
  item: QueuedRun
  // Null: it waits on something other than a slot, so it has no place in the slot line.
  place: number | null
  now: number
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {place}
      </span>
      <span className="shrink-0 font-medium">{item.automationName}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-muted-foreground" title={item.itemLabel}>
          {item.itemLabel}
        </div>
        {item.holdDetail ? (
          <div className="truncate text-xs text-muted-foreground" title={item.holdDetail}>
            {item.holdDetail}
          </div>
        ) : null}
      </div>
      {item.byHand ? <Badge variant="outline">Run now</Badge> : null}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        waiting {formatDuration(now - (item.dueAt ?? item.queuedAt))}
      </span>
    </li>
  )
}

function ListSection({
  title,
  empty,
  count,
  children
}: {
  title: string
  empty: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-muted-foreground">
        {title} · {count}
      </h3>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/50">
          {children}
        </ul>
      )}
    </section>
  )
}

type MachineProps = Changes & {
  machine: MachineCapacity
  // More than one machine: each section is named, and the page header says no figures of its own.
  named: boolean
  saving: boolean
  now: number
}

// Today's page for one machine: its limits, what runs, what waits, what it gave up on and what finished.
function MachineRuns({
  payload,
  where,
  saving,
  now,
  onLimit,
  onRetryLimit,
  onRetry
}: Omit<MachineProps, 'machine' | 'named'> & {
  payload: CapacityPayload
  where: string
}): React.JSX.Element {
  const gaveUp = payload.gaveUp ?? []
  return (
    <>
      <LimitPanel
        payload={payload}
        where={where}
        saving={saving}
        onChange={onLimit}
        onRetryLimit={onRetryLimit}
      />
      <ListSection title="Running now" empty="Nothing is running." count={payload.running.length}>
        {payload.running.map((run) => (
          <RunningRow key={run.id} run={run} now={now} />
        ))}
      </ListSection>
      <ListSection title="Waiting" empty="Nothing is waiting." count={payload.queued.length}>
        {payload.queued.map((item) => (
          <QueuedRow
            key={`${item.automationId}:${item.itemKey}`}
            item={item}
            place={placeInLine(payload.queued, item)}
            now={now}
          />
        ))}
      </ListSection>
      {gaveUp.length > 0 ? (
        <ListSection title="Gave up" empty="" count={gaveUp.length}>
          {gaveUp.map((item) => (
            <GaveUpRow
              key={`${item.automationId}:${item.onceKey}`}
              item={item}
              saving={saving}
              onRetry={onRetry}
            />
          ))}
        </ListSection>
      ) : null}
      <FinishedRuns runs={payload.finished} now={now} onRetry={onRetry} />
    </>
  )
}

function MachineHeading({
  machine: { host, payload },
  named
}: Pick<MachineProps, 'machine' | 'named'>): React.JSX.Element | null {
  if (!named) {
    return null
  }
  return (
    <div>
      <h3 className="text-sm font-semibold leading-6">{host.machineName}</h3>
      {payload ? <p className="text-xs text-muted-foreground">{usageText(payload)}</p> : null}
    </div>
  )
}

function MachineSection({ machine, named, ...rest }: MachineProps): React.JSX.Element {
  const { host, payload, error } = machine
  const heading = <MachineHeading machine={machine} named={named} />
  let where = 'this Mac'
  if (named) {
    where = host.machineName
  }
  if (host.state === 'offline') {
    return (
      <section aria-label={host.machineName} className="flex flex-col gap-4">
        {heading}
        <p className="text-sm text-muted-foreground">
          {host.machineName} can&apos;t be reached. Losing contact doesn&apos;t stop its runs; they
          just aren&apos;t visible from here.
        </p>
      </section>
    )
  }
  // Its runs open, resume and read on this section's machine.
  return (
    <PilotHostProvider host={host}>
      <section aria-label={host.machineName} className="flex flex-col gap-4">
        {heading}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {payload ? <MachineRuns payload={payload} where={where} {...rest} /> : null}
      </section>
    </PilotHostProvider>
  )
}

// Each change a machine's section makes goes to that machine.
function changesFor(changes: CapacityChanges, machine: MachineCapacity): Changes {
  const { host } = machine
  return {
    onLimit: (limit) => void changes.setLimit(host, limit),
    onRetryLimit: (limit) => void changes.setRetryLimit(host, limit),
    onRetry: (key) => void changes.retry(host, key)
  }
}

// What runs now, what waits in line order, what the runner gave up on, and how many jobs may run at once and how often
// a failed one is retried (main/capacity), per machine.
export function RunningPage(): React.JSX.Element {
  const { machines, saving, ...changes } = useCapacities()
  const now = useNow(true)
  const named = machines.length > 1
  const only = named ? null : machines[0]?.payload
  return (
    <section className="flex max-w-6xl flex-col gap-4 px-5 pb-6 pt-4">
      <div>
        <h2 className="text-sm font-semibold leading-6">Running</h2>
        <p className="text-xs text-muted-foreground">
          {only ? usageText(only) : 'Jobs running now, and what is waiting to start, with why.'}
        </p>
      </div>
      <div className="flex flex-col gap-8">
        {machines.map((machine) => (
          <MachineSection
            key={machine.host.key}
            machine={machine}
            named={named}
            saving={saving === machine.host.key}
            now={now}
            {...changesFor(changes, machine)}
          />
        ))}
      </div>
    </section>
  )
}
