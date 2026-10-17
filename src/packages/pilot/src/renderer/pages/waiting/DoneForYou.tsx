import { useState } from 'react'
import type { DoneRun } from '../../../shared/visibility-types'
import { hostedKey, hostOf, type PilotHostRef } from '../../hosts/pilot-host'
import { ActivityRunRow } from '../../run-views/ActivityRunRow'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { errorText } from '../format'

type ShownRun = DoneRun & { run: { host?: PilotHostRef } }

// Run ids are per machine, so two machines' runs can share one.
function runKey(d: ShownRun): string {
  return hostedKey(hostOf(d.run), d.run.id)
}

// Done for you (Run visibility spec §3): finished runs that changed something outside Pilot or took a default, until
// Got it. A run's open defaults sit under it as their own cards, so Keep and Override work as anywhere.
export function DoneForYou({
  runs,
  cardFor,
  onAcknowledge
}: {
  runs: ShownRun[]
  // By the card's hostedKey: a run's defaults are cards on the run's machine.
  cardFor: (cardKey: string) => React.ReactNode
  onAcknowledge: (runIds: string[]) => Promise<string | null>
}): React.JSX.Element | null {
  const { byId } = useAutomationsFeed()
  // An acknowledge error is kept with the list it came from, so it goes when the list changes.
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  if (runs.length === 0) {
    return null
  }
  const listKey = runs.map(runKey).join(',')
  const error = failure?.key === listKey ? failure.text : null
  const acknowledge = async (ids: string[]): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const failed = await onAcknowledge(ids)
      setFailure(failed ? { key: listKey, text: failed } : null)
    } catch (e) {
      setFailure({ key: listKey, text: errorText(e) })
    } finally {
      setBusy(false)
    }
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
          disabled={busy}
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
            key={runKey(d)}
            run={d.run}
            host={hostOf(d.run)}
            fields={d.run.fields}
            summary={byId.get(d.run.automationId)}
            effects={d.effects}
          >
            {d.defaults.map((c) => {
              const key = hostedKey(hostOf(d.run), c.id)
              return <div key={key}>{cardFor(key)}</div>
            })}
            <button
              type="button"
              disabled={busy}
              aria-label={`Got it: ${d.run.itemLabel}`}
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
