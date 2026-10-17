import type { ActivityPayload, ActivityRun, ActivityTick, ListedRun } from '../../shared/api-types'
import { answered } from './answered-reads'
import type { HostRead } from './host-poll'
import { hostedKey, hostOf, type Hosted, type PilotHostRef } from './pilot-host'

// Omits runs so they read as tagged; it still fits wherever an ActivityTick goes.
export type HostedTick = Omit<Hosted<ActivityTick>, 'runs'> & { runs: Hosted<ActivityRun>[] }
export type MergedActivity = Omit<ActivityPayload, 'live' | 'ticks' | 'loose'> & {
  live: Hosted<ListedRun>[]
  ticks: HostedTick[]
  loose: Hosted<ListedRun>[]
}

// Run ids are numbered per machine's database, so only id plus machine names one run.
export function hostedRunKey(run: { id: string; host?: PilotHostRef }): string {
  return hostedKey(hostOf(run), run.id)
}

function newestFirst<T extends { startedAt: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.startedAt - a.startedAt)
}

// Older engines may send no reach.
function reachOf(reads: readonly ActivityPayload[]): number | null {
  const reaches = reads.flatMap((p) => (typeof p.reach === 'number' ? [p.reach] : []))
  return reaches.length > 0 ? Math.max(...reaches) : null
}

export function mergeActivity(reads: readonly HostRead<ActivityPayload>[]): MergedActivity | null {
  const got = answered(reads)
  if (got.length === 0) {
    return null
  }
  // Each machine's list is whole only back to its own reach, so past the latest one a machine would look emptier.
  const reach = reachOf(got.map((g) => g.value))
  const inReach = <T extends { startedAt: number }>(list: readonly T[]): readonly T[] =>
    reach === null ? list : list.filter((x) => x.startedAt >= reach)
  return {
    live: newestFirst(got.flatMap(({ host, value }) => value.live.map((r) => ({ ...r, host })))),
    ticks: newestFirst(
      inReach(
        got.flatMap(({ host, value }) =>
          value.ticks.map((t) => ({ ...t, host, runs: t.runs.map((r) => ({ ...r, host })) }))
        )
      )
    ),
    loose: newestFirst(
      inReach(got.flatMap(({ host, value }) => value.loose.map((r) => ({ ...r, host }))))
    ),
    reach
  }
}
