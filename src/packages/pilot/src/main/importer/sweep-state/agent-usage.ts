import { emptyPlan } from './plans'
import type { SweepStateMapper } from './types'

const FOLDER = '08 · Tally token usage by job'

// 08 is retired: the engine writes usage.json itself (Task 29c). The old tally's rows, for sessions Pilot
// never ran and for totals Claude's 30-day pruning would otherwise lose, are handed over as usage-legacy.json beside
// it, which Pilot's report keeps (Task 29b). That file is also the marker that lets Pilot write into the folder.
// The hand-over was applied on 2026-10-12.
export const agentUsageState: SweepStateMapper = {
  automationId: 'agent-usage',
  plan(read) {
    const from = read.vaultPath(`${FOLDER}/usage.json`)
    if (read.note(`${FOLDER}/usage.json`) === null) {
      return emptyPlan('agent-usage', [`${from} not found; no history to hand over`])
    }
    return {
      ...emptyPlan('agent-usage', [
        "After --apply Pilot writes this folder's usage.json itself, so apply it only at go-live"
      ]),
      files: [{ from, to: read.vaultPath(`${FOLDER}/usage-legacy.json`) }]
    }
  }
}
