import type { CapacityPayload } from '../shared/api-types-capacity'
import { formatMemory } from '../shared/capacity/format-memory'
import { formatDuration } from '../shared/run/format-duration'
import { workedMs } from '../shared/run/worked-time'

function memoryOf(memoryBytes: number | null, peakBytes: number | null): string {
  if (memoryBytes === null) {
    return peakBytes === null ? 'not measured' : `peak ${formatMemory(peakBytes)}`
  }
  const peak = peakBytes === null ? '' : ` (peak ${formatMemory(peakBytes)})`
  return `${formatMemory(memoryBytes)}${peak}`
}

export function formatCapacity(c: CapacityPayload, now: number): string {
  const counted = c.running.filter((r) => r.counted).length
  const limit = c.limit === null ? 'no limit' : String(c.limit)
  const lines = [
    `Run limit: ${limit} (suggested ${c.suggestion.limit})`,
    c.limit === null ? `Running: ${counted}` : `Running: ${counted} of ${c.limit}`
  ]
  for (const r of c.running) {
    const slot = r.counted ? memoryOf(r.memoryBytes, r.peakBytes) : 'takes no slot'
    lines.push(
      `  ${r.automationName}  ${r.itemLabel}  ${formatDuration(workedMs(r, now))}  ${slot}`
    )
  }
  lines.push(`Waiting: ${c.queued.length}`)
  c.queued.forEach((q, i) => {
    const byHand = q.byHand ? '  (Run now)' : ''
    lines.push(
      `  ${i + 1}. ${q.automationName}  ${q.itemLabel}  waiting ${formatDuration(now - q.queuedAt)}${byHand}`
    )
  })
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
