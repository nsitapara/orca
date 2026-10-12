import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { QueueEntry } from '../../../shared/inbox-types'
import { QUEUE_PILL, queueNote, worktreeName } from './answer-text'

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function UpNextPanel({
  entries,
  onApplyNow
}: {
  entries: QueueEntry[]
  onApplyNow: () => Promise<string | null>
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (entries.length === 0) {
    return null
  }
  const apply = async () => {
    setBusy(true)
    setError(await onApplyNow())
    setBusy(false)
  }
  return (
    <section className="rounded-lg border border-border/50">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <h3 className="text-sm font-semibold">Up next from your answers · {entries.length}</h3>
        <span className="text-xs text-muted-foreground">
          what each saved answer sets off, and when
        </span>
        <span className="flex-1" />
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void apply()}>
          Apply now
        </Button>
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
                {e.fires} · {worktreeName(e.worktreePath)} · {queueNote(e, clock)}
              </span>
            </li>
          )
        })}
      </ul>
      {error ? <p className="px-3 pb-2 text-sm text-destructive">{error}</p> : null}
    </section>
  )
}
