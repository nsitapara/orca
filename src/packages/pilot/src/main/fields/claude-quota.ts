import { fetchActiveClaudeRateLimits } from '../../../../../main/rate-limits/claude-active-usage-fetch'
import type { QuotaReader } from './quota'

// Imported only by attach-main.ts: keeps the rate-limits modules out of orcad's import graph.
export function claudeQuotaReader(): QuotaReader {
  return async () => {
    const limits = await fetchActiveClaudeRateLimits()
    return {
      weekly: limits.weekly?.usedPercent ?? null,
      session: limits.session?.usedPercent ?? null
    }
  }
}
