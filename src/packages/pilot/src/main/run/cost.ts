import { estimateCostUsd } from '../../../../../main/claude-usage/claude-model-pricing'
import { parseClaudeUsageFile } from '../../../../../main/claude-usage/transcript-record-parser'

type Turn = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
}
type Estimate = (
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  cacheWrite1h: number
) => number | null
export type Spent = { costUsd: number | null; tokens: number }
export type CostReader = (transcriptPath: string) => Promise<{
  costUsd: number | null
  tokens: number
}>

// Never throws: an unreadable transcript is "no cost known", not a failed run.
export async function claudeTranscriptCost(
  path: string,
  parse: (p: string) => Promise<Turn[]> = parseClaudeUsageFile as never,
  estimate: Estimate = estimateCostUsd
): Promise<Spent> {
  let turns: Turn[]
  try {
    turns = await parse(path)
  } catch {
    return { costUsd: null, tokens: 0 }
  }
  let cost = 0
  let priced = false
  let tokens = 0
  for (const t of turns) {
    tokens += t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
    const c = estimate(
      t.model,
      t.inputTokens,
      t.outputTokens,
      t.cacheReadTokens,
      t.cacheWriteTokens,
      t.cacheWrite1hTokens
    )
    if (c !== null) {
      cost += c
      priced = true
    }
  }
  return { costUsd: priced ? cost : null, tokens }
}

export function formatCost(usd: number | null): string {
  if (usd === null) {
    return '—'
  }
  return `$${usd.toFixed(2)}`
}
