import { estimateCostUsd } from '../../../../../main/claude-usage/claude-model-pricing'
import { parseClaudeUsageFile } from '../../../../../main/claude-usage/transcript-record-parser'
import type { ClaudeUsageParsedTurn } from '../../../../../main/claude-usage/types'

// Upstream's own types, so a change to the parser or the estimator fails the typecheck here.
type Turn = Pick<
  ClaudeUsageParsedTurn,
  | 'model'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'cacheWrite1hTokens'
>
type Estimate = typeof estimateCostUsd
export type Spent = { costUsd: number | null; tokens: number }
export type CostReader = (transcriptPath: string) => Promise<{
  costUsd: number | null
  tokens: number
}>

// Never throws: an unreadable transcript is "no cost known", not a failed run.
export async function claudeTranscriptCost(
  path: string,
  parse: (p: string) => Promise<Turn[]> = parseClaudeUsageFile,
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
    const c = estimate(t.model, t)
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
