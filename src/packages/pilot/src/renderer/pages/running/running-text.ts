import type { CapacityPayload, CapacityRun } from '../../../shared/api-types-capacity'
import { formatMemory } from '../../../shared/capacity/format-memory'
import { HEADROOM_BYTES } from '../../../shared/capacity/limit-suggestion'

export function usageText(p: CapacityPayload): string {
  const running = p.running.filter((r) => r.counted).length
  const slots =
    p.limit === null ? `${running} running, no limit` : `${running} of ${p.limit} in use`
  return p.queued.length === 0 ? slots : `${slots} · ${p.queued.length} waiting`
}

// Why the suggestion is the number it is, in the page's words (a suggestion only: nothing changes until Nish picks).
export function suggestionText(p: CapacityPayload): string {
  const { suggestion, heaviest } = p
  const perJob = heaviest
    ? `The heaviest job, ${heaviest.automationName}, peaked at ${formatMemory(heaviest.peakBytes)}`
    : `No job has been measured yet, so each counts as ${formatMemory(suggestion.perJobBytes)}`
  const budget = `${formatMemory(suggestion.budgetBytes)} can go to jobs: what's available plus what running jobs hold, less ${formatMemory(HEADROOM_BYTES)} kept free`
  return `${perJob}, and ${budget}.`
}

export function runMemoryText(run: CapacityRun): string {
  if (!run.counted) {
    return 'takes no slot'
  }
  if (run.memoryBytes === null) {
    return run.peakBytes === null ? 'not measured yet' : `peak ${formatMemory(run.peakBytes)}`
  }
  const peak = run.peakBytes === null ? '' : ` · peak ${formatMemory(run.peakBytes)}`
  return `${formatMemory(run.memoryBytes)}${peak}`
}
