import type { FeedPreview, HandoverRow, TickHandover, TickTrigger, Verdict } from './api-types'
import { relativeTime } from './relative-time'

// How a handed-over id's item went, in the arrow's words.
const OUTCOME: Record<Verdict, string> = {
  started: 'started',
  skipped: 'skipped',
  notdue: 'not due',
  out_of_scope: 'not in scope',
  over_limit: 'next tick',
  queued: 'waiting for a slot',
  baselined: 'baselined',
  asked: 'asked first',
  held: 'waiting'
}

function plural(n: number, word: string): string {
  if (n === 1) {
    return `${n} ${word}`
  }
  return `${n} ${word}s`
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function sender(trigger: TickTrigger): string {
  if (trigger.stage === null) {
    return trigger.automationId
  }
  return `stage ${trigger.stage}`
}

// Activity's lines for a tick of a fed stage: the run whose feed triggered it and what that run handed over, the ids
// the tick consumed when they are more than (or other than) the trigger's, and each handover it found expired.
export function handoverActivityLines(tick: {
  trigger?: TickTrigger | null
  handedOver?: readonly HandoverRow[]
}): string[] {
  const lines: string[] = []
  const rows = tick.handedOver ?? []
  const read = unique(rows.filter((h) => h.state === 'consumed').map((h) => h.itemId))
  const trigger = tick.trigger ?? null
  if (trigger) {
    const handed = trigger.ids.length > 0 ? `, handed over ${trigger.ids.join(', ')}` : ''
    lines.push(`Triggered by ${sender(trigger)} run ${trigger.runId}${handed}`)
  }
  const same =
    trigger !== null &&
    read.length === trigger.ids.length &&
    read.every((id) => trigger.ids.includes(id))
  if (read.length > 0 && !same) {
    lines.push(`Read handed-over ids: ${read.join(', ')}`)
  }
  for (const h of rows.filter((r) => r.state === 'expired')) {
    lines.push(
      `Handover of ${h.itemId} from ${senderName(h)} ${h.reason ?? 'expired after 7 days'}`
    )
  }
  return lines
}

// An expired row was either dropped (its id unreadable, not found, not in the stage's list) or waited 7 days.
function expiredWord(h: HandoverRow): string {
  if (h.reason?.startsWith('dropped')) {
    return 'dropped'
  }
  return 'expired'
}

function senderName(h: HandoverRow): string {
  if (h.senderStage === undefined || h.senderStage === null) {
    return h.senderId
  }
  return `stage ${h.senderStage}`
}

// The runs' pronouns: one run is "it", several "they".
function they(runs: number): {
  they: string
  their: string
  verb: (one: string, many: string) => string
} {
  if (runs === 1) {
    return { they: 'it', their: 'its', verb: (one) => one }
  }
  return { they: 'they', their: 'their', verb: (_one, many) => many }
}

function condition(feed: FeedPreview): string {
  const p = they(feed.starts)
  if (feed.when === 'always') {
    return `however ${p.they} ${p.verb('ends', 'end')}`
  }
  return `if ${p.they} ${p.verb('succeeds', 'succeed')}`
}

function readLine(ids: readonly string[]): string {
  if (ids.length === 0) {
    return 'Reads no handed-over ids'
  }
  return `Reads ${plural(ids.length, 'handed-over id')}: ${ids.join(', ')}`
}

function feedLine(feed: FeedPreview, dry: boolean, to: string): string {
  if (feed.starts === 0) {
    if (dry) {
      return `No run would start, so nothing would be handed to ${to}`
    }
    return `No run started, so nothing is handed to ${to}`
  }
  const p = they(feed.starts)
  const runs = plural(feed.starts, 'run')
  if (feed.output === null) {
    const tick = dry ? 'would tick' : p.verb('ticks', 'tick')
    return `${runs} ${tick} ${to} at once ${condition(feed)}`
  }
  const hand = dry ? 'would hand' : p.verb('hands', 'hand')
  const after = feed.run === 'now' ? `${to} then ticks at once` : `${to} reads it on its schedule`
  return `${runs} ${hand} ${to} ${p.their} ${feed.output} output ${condition(feed)}; ${after}`
}

// What a tick says it reads and hands on (TickResult.handover); `dry` words it as what would happen. `nameOf` names a
// receiving stage (the job page says "stage 2"). A stage that feeds others says what it hands on; one that is only
// fed says what it reads.
export function handoverPreviewLines(
  handover: TickHandover,
  dry: boolean,
  nameOf: (automationId: string) => string = (id) => id
): string[] {
  const reads = handover.feeds.length === 0 || handover.read.length > 0
  return [
    ...(reads ? [readLine(handover.read)] : []),
    ...handover.feeds.map((feed) => feedLine(feed, dry, nameOf(feed.to)))
  ]
}

// The job page arrow's most recent handover: each id with how its receiving tick decided it (waiting while pending),
// and when it was handed over.
export function lastHandoverText(rows: readonly HandoverRow[], now: number): string | null {
  if (rows.length === 0) {
    return null
  }
  const each = rows.map((h) => {
    if (h.state === 'pending') {
      return `${h.itemId} waiting`
    }
    if (h.state === 'expired') {
      return `${h.itemId} ${expiredWord(h)}`
    }
    return `${h.itemId} ${h.verdict ? OUTCOME[h.verdict] : 'not read'}`
  })
  return `Last: ${each.join(', ')} · ${relativeTime(rows[0].createdAt, now)}`
}
