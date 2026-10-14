import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ActivityTick } from '../../shared/api-types'
import { handoverActivityLines } from '../../shared/handover-text'
import { RunCard } from '../timeline/RunCard'
import { CheckTable } from './CheckTable'
import { checkedItems, tickLine } from './format'
import type { JobActivityEntry } from './job-flow'

// `tag`: on a job's page, the stage the tick belongs to.
function TickNode({
  tick,
  checkNames,
  tag
}: {
  tick: ActivityTick
  checkNames: string[]
  tag?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const checked = checkedItems(tick.items).map((i) => ({ ...i, key: i.itemKey }))
  return (
    <li className="relative border-l border-border pb-4 pl-5">
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-background" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{new Date(tick.startedAt).toLocaleString()}</span>
        {tag ? <Badge variant="outline">{tag}</Badge> : null}
        <span>{`Tick ${tick.id}`}</span>
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
          {open ? 'Hide checks' : `Why: ${checked.length} items checked`}
        </button>
      ) : null}
      {open && checked.length ? <CheckTable items={checked} checkNames={checkNames} /> : null}
      <ol className="mt-2">
        {tick.runs.map((run) => (
          <RunCard key={run.id} run={run} title={`Run ${run.id} · ${run.itemLabel}`} />
        ))}
      </ol>
    </li>
  )
}

type Note = { at: number; text: string; tag?: string }
const NO_NOTES: Note[] = []

// A note with no tick to sit under (a handover expired before the stage's first tick): an entry of its own.
function NoteNode({ note }: { note: Note }): React.JSX.Element {
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

// Ticks arrive newest first from pilot.automations.activity; `notes` (newest first) come before the first tick.
export function ActivityTimeline({
  ticks,
  checkNames,
  notes = NO_NOTES
}: {
  ticks: ActivityTick[]
  checkNames: string[]
  notes?: Note[]
}): React.JSX.Element {
  if (!ticks.length && !notes.length) {
    return <p className="text-sm text-muted-foreground">No ticks yet.</p>
  }
  return (
    <ol className="ml-1">
      {ticks.map((t) => (
        <TickNode key={t.id} tick={t} checkNames={checkNames} />
      ))}
      {notes.map((n) => (
        <NoteNode key={`${n.at}-${n.text}`} note={n} />
      ))}
    </ol>
  )
}

// A job's page: every stage's ticks in one timeline (mergeJobActivity), each tagged with its stage.
export function JobActivityTimeline({
  entries,
  notes = NO_NOTES
}: {
  entries: JobActivityEntry[]
  notes?: Note[]
}): React.JSX.Element {
  if (!entries.length && !notes.length) {
    return <p className="text-sm text-muted-foreground">No ticks yet.</p>
  }
  return (
    <ol className="ml-1">
      {entries.map((e) => (
        <TickNode
          key={e.tick.id}
          tick={e.tick}
          checkNames={e.checkNames}
          tag={`Stage ${e.stage}`}
        />
      ))}
      {notes.map((n) => (
        <NoteNode key={`${n.tag}-${n.at}-${n.text}`} note={n} />
      ))}
    </ol>
  )
}
