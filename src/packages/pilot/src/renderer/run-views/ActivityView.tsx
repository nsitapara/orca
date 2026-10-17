import type { ActivityPayload, AutomationSummary } from '../../shared/api-types'
import { useHeldMerge } from '../hosts/held-merge'
import { useHostPoll } from '../hosts/host-poll'
import { HostsNotice } from '../hosts/HostsNotice'
import { useLoadedAt } from '../hosts/loaded-at'
import { hostedRunKey, mergeActivity } from '../hosts/merge-activity'
import { mergedError } from '../hosts/merge-inbox'
import { hostedKey, hostOf } from '../hosts/pilot-host'
import { emptyActivityText, QuietTicksSwitch, useHideQuiet } from '../pages/QuietTicksSwitch'
import { groupActivity, type ActivityGroups, type GroupedRun } from './activity-groups'
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

function tagHandler(onTag: Tags['onTag'], automationId: string): (() => void) | undefined {
  if (!onTag) {
    return undefined
  }
  return () => onTag(automationId)
}

// The list was cut: nothing older than this is shown.
function reachText(reach: number): string {
  const at = new Date(reach).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `Showing back to ${at}`
}

function RunSection({
  title,
  runs,
  byId
}: {
  title: string
  runs: GroupedRun[]
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
            key={hostedRunKey(run)}
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
  reach,
  empty
}: {
  groups: ActivityGroups
  byId: Map<string, AutomationSummary>
  notes: Note[]
  reach: number | null
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
                  key={`tick-${hostedKey(hostOf(e.tick), String(e.tick.id))}`}
                  tick={e.tick}
                  byId={byId}
                  tag={tags?.[e.tick.automationId]}
                  onTag={tagHandler(onTag, e.tick.automationId)}
                />
              ) : (
                <ActivityRunRow
                  key={`run-${hostedRunKey(e.run)}`}
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
      {typeof reach !== 'number' ? null : (
        <p className="mt-3 text-xs text-muted-foreground">{reachText(reach)}</p>
      )}
    </>
  )
}

// Every run across the named automations (null: all of them) on every machine, grouped as the Activity page shows them
// (spec §3): the Activity page, an automation's Activity tab and a job's are this view, filtered. `since` null: no time
// bound, the newest `limit` ticks. `notes`: a stage's notes from before its first tick, at the end.
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
  const { byId } = useAutomationsFeed()
  const { reads } = useHostPoll<ActivityPayload>(
    'pilot.activity.list',
    {
      automationIds: automationIds ?? undefined,
      since: since ?? undefined,
      limit,
      skipQuiet: hideQuiet
    },
    ACTIVITY_POLL_MS
  )
  // A changed filter keeps the last list until its first answer, as one machine's page always did.
  const merged = useHeldMerge(reads, mergeActivity)
  const error = mergedError(reads)
  const now = useLoadedAt(reads)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <QuietTicksSwitch hide={hideQuiet} onChange={setHideQuiet} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <HostsNotice reads={reads} what="runs" />
      {merged ? (
        <Body
          groups={groupActivity(merged, now, hostedRunKey)}
          byId={byId}
          tags={tags}
          onTag={onTag}
          notes={notes}
          reach={merged.reach}
          empty={emptyActivityText(hideQuiet)}
        />
      ) : null}
      {!merged && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </div>
  )
}
