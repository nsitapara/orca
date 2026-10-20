import { stat } from 'node:fs/promises'
import type { AgentKind } from '../../shared/definition/types'
import { localDay } from '../../shared/local-day'

export type UsageBucket = {
  // Whose tokens: a step's child sessions can be the other agent's (a Claude orchestrator's Codex checks).
  agent: AgentKind
  day: string
  model: string
  requests: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  costUsd: number | null
}
export type UsageWindow = { from: number; to: number }
export type BucketRow = Omit<UsageBucket, 'agent' | 'day' | 'model'>

export { localDay }

// The moment a log line happened, when it falls inside the step's window; else null.
export function inWindow(timestamp: string, window: UsageWindow): number | null {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms) || ms < window.from || ms > window.to) {
    return null
  }
  return ms
}

export function bucketTokens(
  b: Pick<UsageBucket, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>
): number {
  return b.input + b.cacheRead + b.cacheWrite + b.output
}

function addCost(a: number | null, b: number | null): number | null {
  if (a === null || b === null) {
    return null
  }
  return a + b
}

function putBucket(byKey: Map<string, UsageBucket>, b: UsageBucket): void {
  const key = `${b.day}|${b.model}`
  const old = byKey.get(key)
  if (!old) {
    byKey.set(key, { ...b })
    return
  }
  old.requests += b.requests
  old.input += b.input
  old.cacheRead += b.cacheRead
  old.cacheWrite += b.cacheWrite
  old.output += b.output
  old.costUsd = addCost(old.costUsd, b.costUsd)
}

function sortedBuckets(byKey: ReadonlyMap<string, UsageBucket>): UsageBucket[] {
  return [...byKey.values()].sort((a, b) =>
    `${a.day}|${a.model}`.localeCompare(`${b.day}|${b.model}`)
  )
}

// One bucket per local day and model, like usage.py's day|model buckets. An unpriced model's cost stays null.
export class BucketSet {
  private readonly byKey = new Map<string, UsageBucket>()

  constructor(private readonly agent: AgentKind) {}

  add(ms: number, model: string, row: BucketRow): void {
    putBucket(this.byKey, { agent: this.agent, day: localDay(ms), model, ...row })
  }

  list(): UsageBucket[] {
    return sortedBuckets(this.byKey)
  }
}

// Several sessions' buckets as one step's: the same day and model add up.
export function mergeBuckets(lists: readonly (readonly UsageBucket[])[]): UsageBucket[] {
  const byKey = new Map<string, UsageBucket>()
  for (const list of lists) {
    for (const b of list) {
      putBucket(byKey, b)
    }
  }
  return sortedBuckets(byKey)
}

// A step's totals: the cost of its priced buckets (null when none is priced), every token, and the model that
// did most of the work.
export function totalsOf(buckets: readonly UsageBucket[]): {
  costUsd: number | null
  tokens: number
  model: string | null
} {
  let cost = 0
  let priced = false
  let tokens = 0
  const byModel = new Map<string, number>()
  for (const b of buckets) {
    const t = bucketTokens(b)
    tokens += t
    byModel.set(b.model, (byModel.get(b.model) ?? 0) + t)
    if (b.costUsd !== null) {
      cost += b.costUsd
      priced = true
    }
  }
  let model: string | null = null
  for (const [name, t] of byModel) {
    if (model === null || t > (byModel.get(model) ?? 0)) {
      model = name
    }
  }
  return { costUsd: priced ? cost : null, tokens, model }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
