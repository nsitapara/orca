import { Badge } from '@/components/ui/badge'
import type { AutomationListPayload, AutomationSummary } from '../../shared/api-types'
import { lastTickText } from './format'

const COLS =
  'grid grid-cols-[minmax(14rem,2fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(12rem,1.5fr)_6rem] gap-3'

export function scheduleText(a: AutomationSummary): string {
  return a.schedule === 'manual' ? 'Run by hand' : a.schedule
}

function Row({
  a,
  now,
  onOpen
}: {
  a: AutomationSummary
  now: number
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(a.id)}
      className={`${COLS} min-h-11 w-full border-t border-border/50 px-3 py-3 text-left text-sm hover:bg-accent`}
    >
      <span className="truncate font-medium">{a.name}</span>
      <span className="truncate text-muted-foreground">{a.itemKind}</span>
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span className="truncate text-muted-foreground">
        {a.lastTick ? lastTickText(a.lastTick, now) : 'Never'}
      </span>
      <span>
        <Badge variant={a.enabled ? 'secondary' : 'outline'}>
          {a.enabled ? 'Enabled' : 'Paused'}
        </Badge>
      </span>
    </button>
  )
}

export function AutomationsTable({
  payload,
  now,
  onOpen
}: {
  payload: AutomationListPayload
  now: number
  onOpen: (id: string) => void
}): React.JSX.Element {
  if (!payload.automations.length) {
    return <p className="text-sm text-muted-foreground">No automations found.</p>
  }
  return (
    <div className="rounded-md border border-border/50 bg-muted/20">
      <div
        className={`${COLS} h-8 items-center px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground`}
      >
        <span>Name</span>
        <span>Looks at</span>
        <span>Schedule</span>
        <span>Last tick</span>
        <span>Status</span>
      </div>
      {payload.automations.map((a) => (
        <Row key={a.id} a={a} now={now} onOpen={onOpen} />
      ))}
    </div>
  )
}
