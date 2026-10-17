import type { RunRow } from '../api-types'

// How long a run has worked by `until` (its end, or now): the spans it sat ended before Continue run reopened it
// don't count.
export function workedMs(run: Pick<RunRow, 'startedAt' | 'idleMs'>, until: number): number {
  return Math.max(0, until - run.startedAt - (run.idleMs ?? 0))
}
