import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ActivityRun } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'
import { runSpan } from '../../run-views/FromRun'
import { openRun } from '../../run-views/run-panel-state'
import { showActivity } from '../automations-view'
import { QUEUE_PILL, heldTooLong, queueNote, queueSummary, worktreeName } from './answer-text'
import { useNow } from './use-now'

export type RunningRun = { run: ActivityRun; automationName: string }
export type ApplyResult = { said: string; failed: boolean }

function RunningList({ running }: { running: RunningRun[] }): React.JSX.Element {
  return (
    <section aria-label="Running">
      <div className="flex items-center gap-2 px-3 pt-2 text-xs font-semibold text-muted-foreground">
        <span>Running · {running.length}</span>
        <span className="flex-1" />
        <button type="button" className="font-normal underline" onClick={() => showActivity(null)}>
          Activity →
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-border/50">
        {running.map(({ run, automationName }) => (
          <li key={run.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{automationName}</span>
            <span
              className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              title={run.itemLabel}
            >
              {run.itemLabel}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{runSpan(run)}</span>
            <span className="flex-1" />
            <button type="button" className="text-xs underline" onClick={() => openRun(run.id)}>
              Open run
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function QueueList({ entries, now }: { entries: QueueEntry[]; now: number }): React.JSX.Element {
  return (
    <section aria-label="Up next from your answers">
      <div className="flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">Up next from your answers · {entries.length}</span>
        <span>what each saved answer sets off, and when</span>
      </div>
      <ul className="flex flex-col divide-y divide-border/50">
        {entries.map((e) => {
          const pill =
            e.state === 'not_ready' || e.state === 'ready' || e.state === 'held'
              ? QUEUE_PILL[e.state]
              : null
          return (
            <li key={e.rowId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{e.title}</span>
                {pill ? <Badge variant={pill.variant}>{pill.label}</Badge> : null}
              </div>
              <span className="text-xs text-muted-foreground">
                {e.fires} · {worktreeName(e.worktreePath)} · {queueNote(e, now)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// What's going and what your saved answers set off next, folded to one line at the top of the Inbox. It opens by itself
// while an answer has been held 20+ minutes (until you close it; a newly overdue one opens it again).
export function InMotionPanel({
  running,
  entries,
  onApplyNow
}: {
  running: RunningRun[]
  entries: QueueEntry[]
  onApplyNow: () => Promise<ApplyResult>
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [picked, setPicked] = useState(false)
  const [dismissed, setDismissed] = useState<number[]>([])
  // Ticks while any answer waits: the countdowns move, and a hold turns overdue without a reload.
  const now = useNow(entries.length > 0)
  if (running.length === 0 && entries.length === 0) {
    return null
  }
  const overdue = entries.filter((e) => heldTooLong(e, now)).map((e) => e.rowId)
  const open = picked || overdue.some((id) => !dismissed.includes(id))
  const toggle = (next: boolean) => {
    setPicked(next)
    if (!next) {
      setDismissed(overdue)
    }
  }
  const apply = async () => {
    setBusy(true)
    setResult(null)
    setResult(await onApplyNow())
    setBusy(false)
  }
  const line = [
    running.length ? `${running.length} running` : null,
    entries.length ? queueSummary(entries, now) : null
  ].filter((part) => part !== null)
  return (
    <Collapsible
      open={open}
      onOpenChange={toggle}
      className="rounded-lg border border-border/50"
      aria-label="In motion"
      role="region"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <span className="font-semibold">In motion</span>
          <span className="min-w-0 truncate text-muted-foreground">{line.join(' · ')}</span>
        </CollapsibleTrigger>
        {result ? (
          <span
            role="status"
            className={cn('text-xs', result.failed ? 'text-destructive' : 'text-muted-foreground')}
          >
            {result.said}
          </span>
        ) : null}
        {entries.length ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Applying…' : 'Apply now'}
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="flex flex-col gap-1 border-t border-border/50 pb-1">
        {running.length ? <RunningList running={running} /> : null}
        {entries.length ? <QueueList entries={entries} now={now} /> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
