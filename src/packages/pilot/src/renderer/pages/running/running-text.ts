import type { CapacityPayload, CapacityRun } from '../../../shared/api-types-capacity'
import { formatMemory } from '../../../shared/capacity/format-memory'
import { HEADROOM_BYTES } from '../../../shared/capacity/limit-suggestion'

function slotsText(running: number, limit: number | null): string {
  if (limit === null) {
    return `${running} running, no limit`
  }
  // A lowered limit stops nothing: the runs past it finish, and new ones wait until they do.
  return running > limit
    ? `${running} running, over the limit of ${limit}`
    : `${running} of ${limit} in use`
}

export function usageText(p: CapacityPayload): string {
  const slots = slotsText(p.running.filter((r) => r.counted).length, p.limit)
  return p.queued.length === 0 ? slots : `${slots} · ${p.queued.length} waiting`
}

// What the machine has now, and what the measured running jobs hold of it; null when memory can't be read.
export function memoryText(p: CapacityPayload): string | null {
  if (!p.memory) {
    return null
  }
  const free = `${formatMemory(p.memory.availableBytes)} available of ${formatMemory(p.memory.totalBytes)}`
  const held = p.running.reduce((sum, r) => sum + (r.counted ? (r.memoryBytes ?? 0) : 0), 0)
  return held === 0
    ? `Memory: ${free}`
    : `Memory: ${free} · running jobs hold ${formatMemory(held)}`
}

// Why the suggestion is the number it is, in the page's words (a suggestion only: nothing changes until Nish picks).
export function suggestionText(p: CapacityPayload): string {
  const { suggestion, heaviest } = p
  const each = formatMemory(suggestion.perJobBytes)
  let perJob = `No job has been measured yet, so each counts as ${each}`
  if (heaviest?.measured) {
    perJob = `The heaviest job, ${heaviest.automationName}, peaked at ${formatMemory(heaviest.peakBytes)}`
  } else if (heaviest) {
    perJob = `${heaviest.automationName} hasn't been measured yet, so each job counts as ${each}`
  }
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

// When a finished run ended: the time of day today, the date as well before today.
export function endedText(ms: number, now: number): string {
  const ended = new Date(ms)
  if (ended.toDateString() === new Date(now).toDateString()) {
    return ended.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return ended.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

// Why a job with an agent step can wait on quota, from the one ceiling main enforces.
export function quotaText(ceiling: { weekly: number; session: number }): string {
  return `Jobs with an agent step wait while Claude or Codex is over ${ceiling.weekly}% weekly or ${ceiling.session}% session.`
}
