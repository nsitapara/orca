import type { ActivityRun, InboxListRow } from '../../shared/api-types'
import { paintRun } from '../../shared/run-views/paint'
import { foldStrip, stripOf } from '../../shared/run-views/strip'
import { useAutomationsFeed } from './automations-feed'
import { RunStrip } from './RunStrip'
import { openRun } from './run-panel-state'

type Asked = Pick<InboxListRow, 'automationId' | 'stepIdx'>

// The part a card waits on: its step (an answer run's steps are keyed answer:N), or the ask before any step.
export function askingPart(
  item: Pick<InboxListRow, 'stepIdx'>,
  run: Pick<ActivityRun, 'trigger'>
): string {
  if (item.stepIdx === null) {
    return 'ask'
  }
  if (run.trigger === 'answer') {
    return `answer:${item.stepIdx}`
  }
  return `step:${item.stepIdx}`
}

export function askedWhere(
  item: Pick<InboxListRow, 'stepIdx'>,
  run: ActivityRun,
  steps: number
): string {
  if (item.stepIdx === null) {
    return run.trigger === 'ask_first' ? `${run.itemLabel} · asks before starting` : run.itemLabel
  }
  return `${run.itemLabel} · step ${item.stepIdx + 1} of ${steps} asked`
}

// A card's "From run" line (spec §3): the run's strip with where it asked lit, where that is, and Open run.
export function FromRun({
  item,
  run
}: {
  item: Asked
  run: ActivityRun | null
}): React.JSX.Element | null {
  const summary = useAutomationsFeed().byId.get(item.automationId)
  if (!run || !summary) {
    return null
  }
  const parts = paintRun(summary.chain, { run }).parts
  const steps = parts.filter((p) => p.kind === 'step').length
  return (
    <div
      data-from-run=""
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="font-semibold">From run</span>
      <RunStrip
        items={foldStrip(stripOf(parts))}
        label={`Run ${run.id}`}
        onChip={(chip) => openRun(run.id, chip.part)}
      />
      <span>{askedWhere(item, run, steps)}</span>
      <button
        type="button"
        className="underline"
        onClick={() => openRun(run.id, askingPart(item, run))}
      >
        Open run
      </button>
    </div>
  )
}
