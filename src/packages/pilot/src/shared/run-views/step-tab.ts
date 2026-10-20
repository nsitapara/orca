import type { StepRow } from '../api-types'
import type { RunTab } from '../api-types-capacity'

// The tab of an agent step whose session is up: running, or detached (done, its session going on). A paneKey reads
// "<tabId>:<pane>", and only the tab id can hold a colon.
export function stepTabOf(step: StepRow, worktreePath: string | null): RunTab | undefined {
  const live = step.status === 'running' || step.detached
  if (!live || step.kind !== 'agent' || step.paneKey === null || worktreePath === null) {
    return undefined
  }
  const cut = step.paneKey.lastIndexOf(':')
  const tabId = cut === -1 ? step.paneKey : step.paneKey.slice(0, cut)
  return tabId ? { worktreePath, tabId } : undefined
}

// A run's tab: its running agent step's, else its latest detached one's.
export function runTabOf(
  steps: readonly StepRow[],
  worktreePath: string | null
): RunTab | undefined {
  const running = steps.filter((s) => s.status === 'running' && !s.detached)
  const detached = steps.filter((s) => s.detached).toReversed()
  for (const step of [...running, ...detached]) {
    const tab = stepTabOf(step, worktreePath)
    if (tab) {
      return tab
    }
  }
  return undefined
}
