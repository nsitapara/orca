// Retries after a failure (the Running page): a failed run is tried again this many times, then the runner gives up.
export const DEFAULT_RETRY_LIMIT = 2
export const MAX_RETRY_LIMIT = 5
// A failed run's retry waits this long when its job sets no retry_after_failure.
export const DEFAULT_RETRY_AFTER_MS = 600_000

export function clampRetryLimit(limit: number): number {
  return Math.min(Math.max(Math.round(limit), 0), MAX_RETRY_LIMIT)
}
