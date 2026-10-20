import type { CapacityPayload, CapacityRun, RunStep } from '../../../shared/api-types-capacity'
import { formatMemory } from '../../../shared/capacity/format-memory'
import { HEADROOM_BYTES } from '../../../shared/capacity/limit-suggestion'
import { DEFAULT_RETRY_AFTER_MS } from '../../../shared/capacity/retry-limit'
import { waitsForSlot } from '../../../shared/capacity/waiting-rows'

// The step a run is on, with its skill and mode where it has them: "Step answers · ui-qa · answers mode".
export function stepText(step: RunStep): string {
  const parts = [`Step ${step.name}`]
  if (step.skill) {
    parts.push(step.skill)
  }
  if (step.mode) {
    parts.push(`${step.mode} mode`)
  }
  return parts.join(' · ')
}

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
  const parts = [slotsText(p.running.filter((r) => r.counted).length, p.limit)]
  const slotWaiters = p.queued.filter(waitsForSlot).length
  const held = p.queued.length - slotWaiters
  // "for a slot" only earns its words once held items are counted apart.
  const waitingWord = held > 0 ? 'waiting for a slot' : 'waiting'
  if (slotWaiters > 0) {
    parts.push(`${slotWaiters} ${waitingWord}`)
  }
  if (held > 0) {
    parts.push(`${held} held`)
  }
  return parts.join(' · ')
}

// What the machine has free now, and what the measured running jobs hold of it; null when memory can't be read.
export function memoryField(p: CapacityPayload): { free: string; held: string | null } | null {
  if (!p.memory) {
    return null
  }
  const free = `${formatMemory(p.memory.availableBytes)} free of ${formatMemory(p.memory.totalBytes)}`
  const held = p.running.reduce((sum, r) => sum + (r.counted ? (r.memoryBytes ?? 0) : 0), 0)
  return { free, held: held === 0 ? null : `Running jobs hold ${formatMemory(held)}` }
}

function retriesText(limit: number): string {
  return limit === 1 ? '1 retry' : `${limit} retries`
}

// The header's line beside Limits & how it works: the limits as set, with what an older Pilot doesn't send left out.
export function limitsSummary(p: CapacityPayload): string {
  const parts = [p.limit === null ? 'no limit at once' : `${p.limit} at once`]
  if (p.retryLimit !== undefined) {
    parts.push(retriesText(p.retryLimit))
  }
  if (p.quotaCeiling) {
    parts.push(`quota stops at ${p.quotaCeiling.weekly}% / ${p.quotaCeiling.session}%`)
  }
  return parts.join(' · ')
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

// The retry field's line: the runner's wait when a job sets none, and what happens past the limit.
export function retryHint(): string {
  const minutes = DEFAULT_RETRY_AFTER_MS / 60_000
  return `${minutes} min apart, or the job's retry_after_failure; past it, a card`
}
