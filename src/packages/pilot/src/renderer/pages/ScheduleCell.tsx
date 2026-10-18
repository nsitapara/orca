import { cn } from '@/lib/utils'
import type { AutomationSummary } from '../../shared/api-types'
import { usePilotHosts } from '../hosts/pilot-hosts-feed'
import { runsOnLine } from '../hosts/runs-on-text'

export function scheduleText(a: AutomationSummary): string {
  return a.schedule === 'manual' ? 'Run by hand' : a.schedule
}

// The list's Schedule cell, with where a pinned job runs under it. That line wraps inside the cell, so a long name
// never takes room from the name column.
export function ScheduleCell({ a }: { a: AutomationSummary }): React.JSX.Element {
  const runsOn = runsOnLine(a, usePilotHosts())
  if (!runsOn) {
    return <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
      <span
        className={cn(
          'break-words text-xs',
          runsOn.warn ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {runsOn.text}
      </span>
    </span>
  )
}
