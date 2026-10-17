import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CapacityPayload, CapacityRun, QueuedRun } from '../../../shared/api-types-capacity'
import { formatDuration } from '../../../shared/run/format-duration'
import { openRun } from '../../run-views/run-panel-state'
import { useNow } from '../waiting/use-now'
import { FinishedRuns } from './FinishedRuns'
import { RunLimitPicker } from './RunLimitPicker'
import { memoryText, runMemoryText, suggestionText, usageText } from './running-text'
import { useCapacity } from './use-capacity'

function LimitPanel({
  payload,
  saving,
  onChange
}: {
  payload: CapacityPayload
  saving: boolean
  onChange(limit: number | null): void
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
          {suggestionText(payload)} Memory counts each job&apos;s processes on this Mac, not
          Docker&apos;s containers.
        </p>
      </div>
    </section>
  )
}

function RunningRow({ run, now }: { run: CapacityRun; now: number }): React.JSX.Element {
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
        {formatDuration(now - run.startedAt)}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {runMemoryText(run)}
      </span>
      <button type="button" className="shrink-0 text-xs underline" onClick={() => openRun(run.id)}>
        Open run
      </button>
    </li>
  )
}

function QueuedRow({
  item,
  place,
  now
}: {
  item: QueuedRun
  place: number
  now: number
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {place}
      </span>
      <span className="shrink-0 font-medium">{item.automationName}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        title={item.itemLabel}
      >
        {item.itemLabel}
      </span>
      {item.byHand ? <Badge variant="outline">Run now</Badge> : null}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        waiting {formatDuration(now - item.queuedAt)}
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

// What runs now, what waits for a slot in line order, and how many jobs may run at once (main/capacity).
export function RunningPage(): React.JSX.Element {
  const { payload, error, saving, setLimit } = useCapacity()
  const now = useNow(true)
  return (
    <section className="flex max-w-6xl flex-col gap-4 px-5 pb-6 pt-4">
      <div>
        <h2 className="text-sm font-semibold leading-6">Running</h2>
        <p className="text-xs text-muted-foreground">
          {payload ? usageText(payload) : 'Jobs running now, and the ones waiting for a slot.'}
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {payload ? (
        <>
          <LimitPanel
            payload={payload}
            saving={saving}
            onChange={(limit) => void setLimit(limit)}
          />
          <ListSection
            title="Running now"
            empty="Nothing is running."
            count={payload.running.length}
          >
            {payload.running.map((run) => (
              <RunningRow key={run.id} run={run} now={now} />
            ))}
          </ListSection>
          <ListSection
            title="Waiting for a slot"
            empty="Nothing is waiting."
            count={payload.queued.length}
          >
            {payload.queued.map((item, i) => (
              <QueuedRow
                key={`${item.automationId}:${item.itemKey}`}
                item={item}
                place={i + 1}
                now={now}
              />
            ))}
          </ListSection>
          <FinishedRuns runs={payload.finished} now={now} />
        </>
      ) : null}
    </section>
  )
}
