import { tabSessions } from './tabs'
import type { SweepStateMapper } from './types'

// 06 kept no handled state (it re-checks every MR's threads each tick); only its open feedback tabs carry over,
// so a tab still open at cutover keeps blocking a repeat in that worktree. Open note items move with Task 27.
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
