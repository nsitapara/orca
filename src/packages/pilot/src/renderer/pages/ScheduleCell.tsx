import type { AutomationSummary } from '../../shared/api-types'

export function scheduleText(a: AutomationSummary): string {
  return a.schedule === 'manual' ? 'Run by hand' : a.schedule
}

// The list's Schedule cell.
export function ScheduleCell({ a }: { a: AutomationSummary }): React.JSX.Element {
  return <span className="truncate text-muted-foreground">{scheduleText(a)}</span>
}
