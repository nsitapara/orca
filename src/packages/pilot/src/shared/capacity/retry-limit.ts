// Retries after a failure (the Running page): a failed run is tried again this many times, then the runner gives up.
export const DEFAULT_RETRY_LIMIT = 2
export const MAX_RETRY_LIMIT = 5
// A failed run's retry waits this long when its job sets no retry_after_failure.
export const DEFAULT_RETRY_AFTER_MS = 600_000

// give_up: never: each retry waits twice as long as the last, up to this.
export const MAX_RETRY_BACKOFF_MS = 60 * 60_000

// The wait before retry n+1 of a job that never gives up: retry_after_failure, doubled for each failure since the first.
export function retryBackoffMs(afterMs: number, failures: number): number {
  return Math.min(afterMs * 2 ** Math.max(failures - 1, 0), Math.max(afterMs, MAX_RETRY_BACKOFF_MS))
}

export function clampRetryLimit(limit: number): number {
  return Math.min(Math.max(Math.round(limit), 0), MAX_RETRY_LIMIT)
}
