import type { Who } from '../../shared/run-views/chain'
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
// A part in its run's state: lit running, amber asking, struck-through skipped, red failed, dashed not reached.
export const STATE_CLASS: Record<PartState, string> = {
  done: '',
  running: 'ring-2 ring-sky-500/60',
  asking: 'ring-2 ring-amber-500/70',
  skipped: 'line-through opacity-60',
  failed: 'border-destructive/60 bg-destructive/10 text-destructive',
  not_reached: 'border-dashed opacity-60',
  none: 'opacity-40'
}
