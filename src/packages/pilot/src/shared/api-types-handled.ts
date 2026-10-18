// The run holding a once_per key settles it: done, or failed (the runner's retry waits from failedAt).
export type HandledStatus = 'started' | 'done' | 'failed'
export type HandledRow = {
  onceKey: string
  runId: string | null
  at: number
  status: HandledStatus
  failedAt: number | null
  // Failed runs on the key since it last ended done; past the retry limit the runner gives up.
  failures: number
  // The outcome of the run holding the key, if that run is still stored.
  lastOutcome: string | null
}
