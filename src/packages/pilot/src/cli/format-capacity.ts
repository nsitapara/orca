import type { CapacityPayload, GaveUpKey, QueuedRun } from '../shared/api-types-capacity'
import { formatMemory } from '../shared/capacity/format-memory'
import { failedTimesText, waitsForSlot } from '../shared/capacity/waiting-rows'
import { formatDuration } from '../shared/run/format-duration'
import { workedMs } from '../shared/run/worked-time'

function memoryOf(memoryBytes: number | null, peakBytes: number | null): string {
  if (memoryBytes === null) {
    return peakBytes === null ? 'not measured' : `peak ${formatMemory(peakBytes)}`
  }
  const peak = peakBytes === null ? '' : ` (peak ${formatMemory(peakBytes)})`
  return `${formatMemory(memoryBytes)}${peak}`
}

function waitingCount(queued: readonly QueuedRun[]): string {
  const slot = queued.filter(waitsForSlot).length
  const held = queued.length - slot
  if (held === 0) {
    return `Waiting: ${slot}`
  }
  const parts = slot > 0 ? [`${slot} for a slot`, `${held} held`] : [`${held} held`]
  return `Waiting: ${parts.join(' · ')}`
}

// Only slot waiters have a place in line; a held row says why it waits, and it has waited since it became due.
function waitingRows(queued: readonly QueuedRun[], now: number): string[] {
  let place = 0
  return queued.map((q) => {
    let mark = '- '
    if (waitsForSlot(q)) {
      place += 1
      mark = `${place}.`
    }
    const byHand = q.byHand ? '  (Run now)' : ''
    const detail = q.holdDetail ? `  ${q.holdDetail}` : ''
    const waited = formatDuration(now - (q.dueAt ?? q.queuedAt))
    return `  ${mark} ${q.automationName}  ${q.itemLabel}  waiting ${waited}${byHand}${detail}`
  })
}

function gaveUpRows(gaveUp: readonly GaveUpKey[]): string[] {
  if (gaveUp.length === 0) {
    return []
  }
  const rows = gaveUp.map((g) => {
    const outcome = g.outcome ? `  ${g.outcome}` : ''
    return `  ${g.automationName}  ${g.itemLabel}  ${failedTimesText(g.failures)}${outcome}`
  })
  return [`Gave up: ${gaveUp.length}`, ...rows]
}

export function formatCapacity(c: CapacityPayload, now: number): string {
  const counted = c.running.filter((r) => r.counted).length
  const limit = c.limit === null ? 'no limit' : String(c.limit)
  const lines = [
    `Run limit: ${limit} (suggested ${c.suggestion.limit})`,
    ...(c.retryLimit === undefined ? [] : [`Retries after a failure: ${c.retryLimit}`]),
    c.limit === null ? `Running: ${counted}` : `Running: ${counted} of ${c.limit}`
  ]
  for (const r of c.running) {
    const slot = r.counted ? memoryOf(r.memoryBytes, r.peakBytes) : 'takes no slot'
    lines.push(
      `  ${r.automationName}  ${r.itemLabel}  ${formatDuration(workedMs(r, now))}  ${slot}`
    )
  }
  lines.push(waitingCount(c.queued), ...waitingRows(c.queued, now), ...gaveUpRows(c.gaveUp ?? []))
  if (c.memory) {
    lines.push(
      `Memory: ${formatMemory(c.memory.availableBytes)} available of ${formatMemory(c.memory.totalBytes)}`
    )
  }
  const each = formatMemory(c.suggestion.perJobBytes)
  let per = `no job measured yet, so ${each} each`
  if (c.heaviest?.measured) {
    per = `heaviest job ${c.heaviest.automationName} peaked at ${formatMemory(c.heaviest.peakBytes)}`
  } else if (c.heaviest) {
    per = `${c.heaviest.automationName} not measured yet, so ${each} each`
  }
  lines.push(`Suggestion: ${c.suggestion.limit}, ${per}`)
  return lines.join('\n')
}
