import { tabSessions } from './tabs'
import type { SweepStateMapper } from './types'

// 06 kept no handled state (it re-checks every MR's threads each tick). Its tabs.json is imported as a record
// of the sessions it had, but Orca's terminal handles are never live in Pilot, so an imported tab blocks
// nothing: 06's first Pilot tick may repeat a round in a worktree whose old tab is still open. Open note items
// move with Task 27.
export const mrFeedbackState: SweepStateMapper = {
  automationId: 'mr-feedback',
  plan(read) {
    const tabs = tabSessions(read, 'mr-feedback')
    return {
      automationId: 'mr-feedback',
      handled: [],
      sessions: tabs.sessions,
      files: [],
      notes: tabs.notes
    }
  }
}
