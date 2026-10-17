import type { Who } from '../../shared/run-views/chain'
import type { RunRow, RunStatus } from '../../shared/api-types'
import { hadNothingToDo } from '../../shared/run/step-plan'
import type { PartState } from '../../shared/run-views/paint'

export const WHO_LABEL: Record<Who, string> = {
  pilot: 'Pilot',
  script: 'Script',
  agent: 'Agent',
  you: 'You'
}
// Who runs a part (spec Decisions): grey Pilot, blue Script, purple Agent, amber You.
export const WHO_CLASS: Record<Who, string> = {
  pilot: 'border-border bg-muted text-muted-foreground',
  script: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  agent: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  you: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}
export const STATE_LABEL: Record<PartState, string> = {
  done: 'Done',
  running: 'Running',
  asking: 'Waiting on you',
  skipped: 'Skipped',
  failed: 'Failed',
  not_reached: 'Not reached',
  none: ''
}
export const STATE_MARK: Record<PartState, string> = {
  done: '✓',
  running: '●',
  asking: '?',
  skipped: '–',
  failed: '✗',
  not_reached: '○',
  none: ''
}
// A part in its run's state: lit running, amber asking, dimmed skipped (never struck through), red failed, dashed not
// reached.
export const STATE_CLASS: Record<PartState, string> = {
  done: '',
  running: 'ring-2 ring-sky-500/60',
  asking: 'ring-2 ring-amber-500/70',
  skipped: 'opacity-60',
  failed: 'border-destructive/60 bg-destructive/10 text-destructive',
  not_reached: 'border-dashed opacity-60',
  none: 'opacity-40'
}
// The one chip a view points at: on a card, the step its question came from.
export const HIGHLIGHT_CLASS = 'ring-2 ring-amber-500/70'
// A run's state as a tag: red when it failed, blue while it runs, amber while it waits on Nish.
export const RUN_TONE: Record<RunStatus, string> = {
  running: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  asking: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  needs_you: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  done: 'bg-muted text-foreground',
  failed: 'bg-destructive/10 text-destructive',
  timed_out: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground'
}

// A run that had nothing to do reads quiet, as a cancelled one does, rather than as work done.
export function runTone(run: Pick<RunRow, 'status' | 'outcome'>): string {
  if (hadNothingToDo(run)) {
    return RUN_TONE.cancelled
  }
  return RUN_TONE[run.status]
}
