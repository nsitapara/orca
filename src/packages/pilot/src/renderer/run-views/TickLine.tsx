import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ActivityTick, AutomationSummary } from '../../shared/api-types'
import { handoverActivityLines } from '../../shared/handover-text'
import { checkNamesOf } from '../../shared/run-views/chain'
import { MachineChip } from '../hosts/MachineChip'
import { hostOf, type PilotHostRef } from '../hosts/pilot-host'
import { CheckTable } from '../pages/CheckTable'
import { checkedItems, clockTime, tickLine } from '../pages/format'
import { fieldsOf, jobCode } from './activity-groups'
import { ActivityRunRow } from './ActivityRunRow'

export type Note = { at: number; text: string; tag?: string }

// A tick's stage on a job's page; with `onOpen`, it opens that stage's own page.
function StageTag({ tag, onOpen }: { tag: string; onOpen?: () => void }): React.JSX.Element {
  const badge = <Badge variant="outline">{tag}</Badge>
  if (!onOpen) {
    return badge
  }
  return (
    <button
      type="button"
      aria-label={`Open ${tag.toLowerCase()}`}
      onClick={onOpen}
      className="rounded-md hover:bg-accent"
    >
      {badge}
    </button>
  )
}

// A note with no tick to sit under (a handover expired before the stage's first tick): an entry of its own.
export function NoteLine({ note }: { note: Note }): React.JSX.Element {
  return (
    <li className="relative border-l border-border pb-4 pl-5">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{new Date(note.at).toLocaleString()}</span>
        {note.tag ? <Badge variant="outline">{note.tag}</Badge> : null}
      </div>
      <div className="text-sm">{note.text}</div>
    </li>
  )
}

function checksToggleText(open: boolean, count: number): string {
  if (open) {
    return 'Hide checks'
  }
  return `Why: ${count} items checked`
}

function checkNamesFor(summary: AutomationSummary | undefined): string[] {
  return summary ? checkNamesOf(summary.chain) : []
}

// One tick on Activity: when, whose, what it decided, what triggered it, why (its checked items), and the runs it
// started that have finished (live ones sit in Running now or Waiting on you).
export function TickLine({
  tick,
  byId,
  tag,
  onTag
}: {
  // An untagged tick is this machine's.
  tick: ActivityTick & { host?: PilotHostRef }
  byId: Map<string, AutomationSummary>
  tag?: string
  onTag?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = byId.get(tick.automationId)
  const checked = checkedItems(tick.items).map((i) => ({ ...i, key: i.itemKey }))
  return (
    <li className="relative border-l border-border pb-4 pl-5">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{clockTime(tick.startedAt)}</span>
        <span className="rounded bg-muted px-1.5 text-foreground">
          {jobCode(summary?.name ?? tick.automationId)}
        </span>
        {tag ? <StageTag tag={tag} onOpen={onTag} /> : null}
        <span>{`Tick ${tick.id}`}</span>
        <MachineChip host={hostOf(tick)} />
      </div>
      <div className="text-sm">{tickLine(tick)}</div>
      {handoverActivityLines(tick).map((line) => (
        <div key={line} className="text-xs">
          {line}
        </div>
      ))}
      {(tick.notes ?? []).map((note) => (
        <div key={`${note.at}-${note.text}`} className="text-xs text-muted-foreground">
          {`${new Date(note.at).toLocaleString()} · ${note.text}`}
        </div>
      ))}
      {(tick.warnings ?? []).map((w) => (
        <div key={w} className="text-xs text-muted-foreground">
          {w}
        </div>
      ))}
      {checked.length ? (
        <button type="button" className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>
          {checksToggleText(open, checked.length)}
        </button>
      ) : null}
      {open && checked.length ? (
        <CheckTable items={checked} checkNames={checkNamesFor(summary)} />
      ) : null}
      {tick.runs.length > 0 ? (
        <ol className="mt-2">
          {tick.runs.map((run) => (
            <ActivityRunRow
              key={run.id}
              run={run}
              fields={fieldsOf(tick, run.id)}
              summary={summary}
            />
          ))}
        </ol>
      ) : null}
    </li>
  )
}
