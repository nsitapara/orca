import { useState } from 'react'
import type { DoneRun } from '../../../shared/visibility-types'
import { ActivityRunRow } from '../../run-views/ActivityRunRow'
import { useAutomationsFeed } from '../../run-views/automations-feed'

// Done for you (Run visibility spec §3): finished runs that changed something outside Pilot or took a default, until
// Got it. A run's open defaults sit under it as their own cards, so Keep and Override work as anywhere.
export function DoneForYou({
  runs,
  cardFor,
  onAcknowledge
}: {
  runs: DoneRun[]
  cardFor: (cardId: string) => React.ReactNode
  onAcknowledge: (runIds: string[]) => Promise<string | null>
}): React.JSX.Element | null {
  const { byId } = useAutomationsFeed()
  const [error, setError] = useState<string | null>(null)
  if (runs.length === 0) {
    return null
  }
  const acknowledge = async (ids: string[]): Promise<void> => {
    setError(await onAcknowledge(ids))
  }
  return (
    <section
      aria-label="Done for you"
      className="flex flex-col gap-2 rounded-lg border border-border/50 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{`Done for you · ${runs.length}`}</h2>
        <span className="text-xs text-muted-foreground">
          what the jobs changed, until you&apos;ve seen it
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="text-xs underline"
          onClick={() => void acknowledge(runs.map((d) => d.run.id))}
        >
          Got all
        </button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ol className="flex flex-col">
        {runs.map((d) => (
          <ActivityRunRow
            key={d.run.id}
            run={d.run}
            fields={d.run.fields}
            summary={byId.get(d.run.automationId)}
            effects={d.effects}
          >
            {d.defaults.map((c) => (
              <div key={c.id}>{cardFor(c.id)}</div>
            ))}
            <button
              type="button"
              className="self-start text-xs underline"
              onClick={() => void acknowledge([d.run.id])}
            >
              Got it
            </button>
          </ActivityRunRow>
        ))}
      </ol>
    </section>
  )
}
