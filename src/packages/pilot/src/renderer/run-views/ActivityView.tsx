import { useEffect, useState } from 'react'
import type { ActivityPayload, AutomationSummary, ListedRun } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { errorText } from '../pages/format'
import { emptyActivityText, QuietTicksSwitch, useHideQuiet } from '../pages/QuietTicksSwitch'
import { groupActivity, type ActivityGroups } from './activity-groups'
import { ActivityRunRow } from './ActivityRunRow'
import { useAutomationsFeed } from './automations-feed'
import { NoteLine, TickLine, type Note } from './TickLine'

export const ACTIVITY_POLL_MS = 20_000
const NO_NOTES: Note[] = []

type Tags = { tags?: Record<string, string>; onTag?: (automationId: string) => void }

function Heading({ children }: { children: string }): React.JSX.Element {
  return (
    <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  )
}

function RunSection({
  title,
  runs,
  byId
}: {
  title: string
  runs: ListedRun[]
  byId: Map<string, AutomationSummary>
}): React.JSX.Element | null {
  if (runs.length === 0) {
    return null
  }
  return (
    <section aria-label={title}>
      <Heading>{title}</Heading>
      <ol>
        {runs.map((run) => (
          <ActivityRunRow
            key={run.id}
            run={run}
            fields={run.fields}
            summary={byId.get(run.automationId)}
          />
        ))}
      </ol>
    </section>
  )
}

function Body({
  groups,
  byId,
  tags,
  onTag,
  notes,
  empty
}: {
  groups: ActivityGroups
  byId: Map<string, AutomationSummary>
  notes: Note[]
  empty: string
} & Tags): React.JSX.Element {
  if (!groups.running.length && !groups.waiting.length && !groups.days.length && !notes.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <>
      <RunSection title="Running now" runs={groups.running} byId={byId} />
      <RunSection title="Waiting on you" runs={groups.waiting} byId={byId} />
      {groups.days.map((d) => (
        <section key={d.key} aria-label={d.label}>
          <Heading>{d.label}</Heading>
          <ol className="ml-1">
            {d.entries.map((e) =>
              e.kind === 'tick' ? (
                <TickLine
                  key={`tick-${e.tick.id}`}
                  tick={e.tick}
                  byId={byId}
                  tag={tags?.[e.tick.automationId]}
                  onTag={onTag ? () => onTag(e.tick.automationId) : undefined}
                />
              ) : (
                <ActivityRunRow
                  key={`run-${e.run.id}`}
                  run={e.run}
                  fields={e.run.fields}
                  summary={byId.get(e.run.automationId)}
                />
              )
            )}
          </ol>
        </section>
      ))}
      {notes.length > 0 ? (
        <ol className="ml-1">
          {notes.map((n) => (
            <NoteLine key={`${n.tag ?? ''}-${n.at}-${n.text}`} note={n} />
          ))}
        </ol>
      ) : null}
    </>
  )
}

// Every run across the named automations (null: all of them), grouped as the Activity page shows them (spec §3): the
// Activity page, an automation's Activity tab and a job's are this view, filtered. `since` null: no time bound, the newest
// `limit` ticks. `notes`: a stage's notes from before its first tick, at the end.
export function ActivityView({
  automationIds,
  since,
  limit,
  tags,
  onTag,
  notes = NO_NOTES
}: {
  automationIds: string[] | null
  since: number | null
  limit: number
  notes?: Note[]
} & Tags): React.JSX.Element {
  const [hideQuiet, setHideQuiet] = useHideQuiet()
  const [loaded, setLoaded] = useState<{ payload: ActivityPayload; now: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { byId } = useAutomationsFeed()
  const key = automationIds ? JSON.stringify(automationIds) : null
  useEffect(() => {
    let alive = true
    const params = {
      automationIds: key === null ? undefined : (JSON.parse(key) as string[]),
      since: since ?? undefined,
      limit,
      skipQuiet: hideQuiet
    }
    const load = (): void => {
      pilotRpc<ActivityPayload>('pilot.activity.list', params).then(
        (p) => {
          if (alive) {
            setLoaded({ payload: p, now: Date.now() })
            setError(null)
          }
        },
        (e: unknown) => {
          if (alive) {
            setError(errorText(e))
          }
        }
      )
    }
    load()
    const timer = setInterval(load, ACTIVITY_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key, since, limit, hideQuiet])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <QuietTicksSwitch hide={hideQuiet} onChange={setHideQuiet} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loaded ? (
        <Body
          groups={groupActivity(loaded.payload, loaded.now)}
          byId={byId}
          tags={tags}
          onTag={onTag}
          notes={notes}
          empty={emptyActivityText(hideQuiet)}
        />
      ) : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </div>
  )
}
