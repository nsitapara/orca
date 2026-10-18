import type { QueuedRun } from '../api-types-capacity'

// How Running and the CLI read the runner's line and the keys it gave up on.

// Waiting on a slot: a capacity hold, or a row from an older Pilot that names none.
export function waitsForSlot(item: QueuedRun): boolean {
  return item.holdCode === undefined || item.holdCode === 'capacity'
}

export function failedTimesText(failures: number): string {
  return failures === 1 ? 'failed 1 time' : `failed ${failures} times`
}
