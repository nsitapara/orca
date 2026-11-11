import type { SessionSearchClock } from './session-search-clock'
import type { SessionSearchScanRoots } from './session-search-scan-roots'

export const DEFAULT_SESSION_SEARCH_RECONCILE_INTERVAL_MS = 20_000
/** Quiet passes double the wait up to this, so an idle machine stops walking every root. */
export const SESSION_SEARCH_IDLE_RECONCILE_MAX_MS = 5 * 60_000
export const DEFAULT_SESSION_SEARCH_RECENT_PER_AGENT = 12
/** Allow a quarter-interval read budget, checked between files; rearm after the pass settles. */
export const DEFAULT_SESSION_SEARCH_PASS_DEADLINE_FRACTION = 4
/** Periodic full sweeps discover old or restored sources that recent cycles cannot see. */
export const DEFAULT_SESSION_SEARCH_FULL_SWEEP_EVERY_CYCLES = 15

export type SessionSearchIndexerOptions = {
  databasePath: string
  roots: SessionSearchScanRoots
  /** Full sweeps refresh host roots; recent cycles reuse the last snapshot. */
  resolveRoots?: (signal: AbortSignal) => Promise<SessionSearchScanRoots>
  /** null = all history; otherwise only transcripts modified within this many days. */
  historyDays: number | null
  clock?: SessionSearchClock
  reconcileIntervalMs?: number
  /**
   * When set, passes that read nothing double the wait up to this; any read returns to the
   * base interval. Deletions and returning roots are then noticed within the stretched wait.
   */
  idleReconcileMaxMs?: number
  recentPerAgent?: number
  /** Read budget checked between files; unfinished candidates remain owed on the next pass. */
  passDeadlineMs?: number
  fullSweepEveryCycles?: number
  onError?: (error: unknown) => void
}
