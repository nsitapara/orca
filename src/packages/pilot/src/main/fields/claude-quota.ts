import { fetchActiveClaudeRateLimits } from '../../../../../main/rate-limits/claude-active-usage-fetch'
import { toQuotaReading, type QuotaReader } from './quota'

// Imported only by attach-main.ts: keeps the rate-limits modules out of orcad's import graph.
export function claudeQuotaReader(): QuotaReader {
  return async () => toQuotaReading(await fetchActiveClaudeRateLimits())
}
