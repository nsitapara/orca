import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { weekStart } from '../run-views/activity-groups'
import { ActivityView } from '../run-views/ActivityView'
import { useAutomationsFeed } from '../run-views/automations-feed'
import {
  pendingActivityFilter,
  setPilotAutomationsView,
  takeActivityFilter,
  usePendingActivityFilter
} from './automations-view'

// Every run across automations for the last week (spec §3, Activity), with a chip per automation to narrow it.
// Mirrors MAX_RUNS_LIMIT in main/rpc/methods-runs.ts: the most ticks one request may ask for.
const MAX_RUNS_LIMIT = 300

export function ActivityPage(): React.JSX.Element {
  const { list } = useAutomationsFeed()
  const pending = usePendingActivityFilter()
  const [chosen, setChosen] = useState<string[]>(() => pendingActivityFilter() ?? [])
  // A filter requested while the page is open applies too; it is cleared in an effect, never while rendering.
  useEffect(() => {
    if (pending) {
      setChosen(pending)
      takeActivityFilter()
    }
  }, [pending])
  const [since] = useState(() => weekStart(Date.now()))
  const toggle = (id: string): void =>
    setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="text-muted-foreground"
          onClick={() => setPilotAutomationsView('automations')}
        >
          Automations
        </button>
        <span className="text-muted-foreground">›</span>
        <span>Activity</span>
      </div>
      <h2 className="text-lg font-semibold">Activity</h2>
      <div role="group" aria-label="Automations shown" className="flex flex-wrap gap-1">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={chosen.includes(a.id)}
            onClick={() => toggle(a.id)}
            className={cn(
              'rounded border px-2 text-xs leading-6',
              chosen.includes(a.id)
                ? 'border-foreground text-foreground'
                : 'border-border text-muted-foreground'
            )}
          >
            {a.name}
          </button>
        ))}
      </div>
      <ActivityView
        automationIds={chosen.length > 0 ? chosen : null}
        since={since}
        limit={MAX_RUNS_LIMIT}
      />
    </div>
  )
}
