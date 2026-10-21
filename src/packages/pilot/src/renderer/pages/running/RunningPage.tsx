import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type {
  CapacityPayload,
  CapacityRun,
  GoNowKey,
  QueuedRun,
  RetryKey
} from '../../../shared/api-types-capacity'
import { canGoNow } from '../../../shared/capacity/go-now'
import { holdReasonText, waitedText, waitsForSlot } from '../../../shared/capacity/waiting-rows'
import { formatDuration } from '../../../shared/run/format-duration'
import { workedMs } from '../../../shared/run/worked-time'
import { PilotHostProvider, usePilotHost } from '../../hosts/PilotHostContext'
import { openRun } from '../../run-views/run-panel-state'
import { useShowTab } from '../../run-views/ShowTab'
import { useStopRun } from '../../run-views/StopRun'
import { useNow } from '../waiting/use-now'
import { FinishedRuns } from './FinishedRuns'
import { LimitsPanel, LimitsToggle } from './LimitsPanel'
import { MergeBackItem } from './MergeBackRows'
import { GaveUpRow } from './Retries'
import { checkOf } from './running-checks'
import { placeBadgeText, placeReasonText } from './running-place'
import { runMemoryText, stepText, usageText } from './running-text'
import { useCapacities, type CapacityChanges, type MachineCapacity } from './use-capacity'

// A machine's changes, bound to it.
type Changes = {
  onLimit(limit: number | null): void
  onRetryLimit(limit: number): void
  onRetry(key: RetryKey): void
  onGoNow(key: GoNowKey): void
}

// Name, where it works, its figures and Open run and Stop on top; the item under it; then why it isn't in your worktree,
// and what Pilot said to a Stop or Show tab.
function RunningRow({ run, now }: { run: CapacityRun; now: number }): React.JSX.Element {
  const host = usePilotHost()
  const why = run.place ? placeReasonText(run.place) : null
  const stop = useStopRun({ id: run.id, status: 'running' }, undefined, run.fromAnswer === true)
  const show = useShowTab(run.tab)
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" title={run.automationName}>
          {run.automationName}
        </span>
        {run.fromAnswer ? <Badge variant="outline">From your answer</Badge> : null}
        {run.place ? <Badge variant="secondary">{placeBadgeText(run.place)}</Badge> : null}
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          {formatDuration(workedMs(run, now))} · {runMemoryText(run)}
        </span>
        <button
          type="button"
          className="shrink-0 text-xs underline"
          onClick={() => openRun(run.id, null, host)}
        >
          Open run
        </button>
        {show.control ? <span className="shrink-0 text-xs">{show.control}</span> : null}
        {/* Why: Stop refuses a shell step (run-stop.ts); a card without a step (older Pilot) still offers it. */}
        {run.step?.kind !== 'shell' && stop.control ? (
          <span className="shrink-0 text-xs">{stop.control}</span>
        ) : null}
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={run.itemLabel}>
        {run.itemLabel}
      </div>
      {run.step ? (
        <div className="truncate text-xs text-muted-foreground">{stepText(run.step)}</div>
      ) : null}
      {why ? <p className="text-xs text-muted-foreground">{why}</p> : null}
      {stop.note ? <p className="text-xs text-muted-foreground">{stop.note}</p> : null}
      {show.note ? <p className="text-xs text-muted-foreground">{show.note}</p> : null}
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

// A slot waiter's place in line, or Held and the check that holds it, as Limits & how it works names them.
function QueuedStatus({
  item,
  place
}: {
  item: QueuedRun
  place: number | null
}): React.JSX.Element {
  if (place !== null) {
    return <Badge variant="outline">#{place} in line</Badge>
  }
  const check = checkOf(item.holdCode)
  return <Badge variant="secondary">{check ? `Held · ${check.name}` : 'Held'}</Badge>
}

// Name, status, time and Go now on top; the item under it; then the reason across the whole row.
function QueuedRow({
  item,
  place,
  now,
  saving,
  onGoNow
}: {
  item: QueuedRun
  // Null: it waits on something other than a slot, so it has no place in the slot line.
  place: number | null
  now: number
  saving: boolean
  onGoNow(key: GoNowKey): void
}): React.JSX.Element {
  const reason = holdReasonText(item)
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" title={item.automationName}>
          {item.automationName}
        </span>
        <QueuedStatus item={item} place={place} />
        {item.byHand ? <Badge variant="outline">Run now</Badge> : null}
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          {waitedText(item, now)}
        </span>
        {canGoNow(item) ? (
          <button
            type="button"
            className="shrink-0 text-xs underline disabled:opacity-50"
            disabled={saving}
            onClick={() => onGoNow({ automationId: item.automationId, itemKey: item.itemKey })}
          >
            Go now
          </button>
        ) : null}
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={item.itemLabel}>
        {item.itemLabel}
      </div>
      {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
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
  // Limits & how it works is open for this machine.
  limitsOpen: boolean
  onToggleLimits(): void
}

// The panel's id, for the toggle's aria-controls: one per machine.
function limitsPanelId(key: string): string {
  return `running-limits-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

// Today's page for one machine: its limits when open, what runs, what waits, the fixes not merged back yet, what it gave
// up on and what finished.
function MachineRuns({
  payload,
  panelId,
  where,
  saving,
  now,
  limitsOpen,
  onLimit,
  onRetryLimit,
  onRetry,
  onGoNow
}: Omit<MachineProps, 'machine' | 'named' | 'onToggleLimits'> & {
  payload: CapacityPayload
  panelId: string
  where: string
}): React.JSX.Element {
  const gaveUp = payload.gaveUp ?? []
  const mergeBack = payload.mergeBack ?? []
  return (
    <>
      {limitsOpen ? (
        <LimitsPanel
          id={panelId}
          payload={payload}
          where={where}
          saving={saving}
          onLimit={onLimit}
          onRetryLimit={onRetryLimit}
        />
      ) : null}
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
            saving={saving}
            onGoNow={onGoNow}
          />
        ))}
      </ListSection>
      <ListSection
        title="Merge back"
        empty="Every fix made in a throwaway is in its worktree."
        count={mergeBack.length}
      >
        {mergeBack.map((row) => (
          <MergeBackItem key={row.runId} row={row} now={now} />
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
      <FinishedRuns runs={payload.finished} now={now} saving={saving} onRetry={onRetry} />
    </>
  )
}

// A named machine's heading carries its own limits toggle; with one machine the page header carries it.
function MachineHeading({
  machine: { host, payload },
  named,
  limitsOpen,
  onToggleLimits
}: Pick<
  MachineProps,
  'machine' | 'named' | 'limitsOpen' | 'onToggleLimits'
>): React.JSX.Element | null {
  if (!named) {
    return null
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold leading-6">{host.machineName}</h3>
        {payload ? <p className="text-xs text-muted-foreground">{usageText(payload)}</p> : null}
      </div>
      {payload && host.state !== 'offline' ? (
        <LimitsToggle
          payload={payload}
          open={limitsOpen}
          controls={limitsPanelId(host.key)}
          onToggle={onToggleLimits}
        />
      ) : null}
    </div>
  )
}

function MachineSection({
  machine,
  named,
  limitsOpen,
  onToggleLimits,
  ...rest
}: MachineProps): React.JSX.Element {
  const { host, payload, error } = machine
  const heading = (
    <MachineHeading
      machine={machine}
      named={named}
      limitsOpen={limitsOpen}
      onToggleLimits={onToggleLimits}
    />
  )
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
        {payload ? (
          <MachineRuns
            payload={payload}
            panelId={limitsPanelId(host.key)}
            where={where}
            limitsOpen={limitsOpen}
            {...rest}
          />
        ) : null}
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
    onRetry: (key) => void changes.retry(host, key),
    onGoNow: (key) => void changes.goNow(host, key)
  }
}

// The machines whose Limits & how it works is open, by host key; all closed at first.
function useOpenLimits(): { isOpen(key: string): boolean; toggle(key: string): void } {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  return {
    isOpen: (key) => open.has(key),
    toggle: (key) =>
      setOpen((current) => {
        const next = new Set(current)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
  }
}

// What runs now, what waits in line order, what the runner gave up on and what finished, per machine, with each
// machine's limits and how the runner decides folded behind Limits & how it works (main/capacity).
export function RunningPage(): React.JSX.Element {
  const { machines, saving, ...changes } = useCapacities()
  const now = useNow(true)
  const limits = useOpenLimits()
  const named = machines.length > 1
  const single = named ? null : machines[0]
  const only = single?.payload ?? null
  return (
    <section className="flex max-w-6xl flex-col gap-4 px-5 pb-6 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold leading-6">Running</h2>
          <p className="text-xs text-muted-foreground">
            {only ? usageText(only) : 'Jobs running now, and what is waiting to start, with why.'}
          </p>
        </div>
        {single && only && single.host.state !== 'offline' ? (
          <LimitsToggle
            payload={only}
            open={limits.isOpen(single.host.key)}
            controls={limitsPanelId(single.host.key)}
            onToggle={() => limits.toggle(single.host.key)}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-8">
        {machines.map((machine) => (
          <MachineSection
            key={machine.host.key}
            machine={machine}
            named={named}
            saving={saving === machine.host.key}
            now={now}
            limitsOpen={limits.isOpen(machine.host.key)}
            onToggleLimits={() => limits.toggle(machine.host.key)}
            {...changesFor(changes, machine)}
          />
        ))}
      </div>
    </section>
  )
}
