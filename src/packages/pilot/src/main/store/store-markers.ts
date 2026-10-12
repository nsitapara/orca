import type Database from '../../../../../main/sqlite/sync-database'

// `<worktree id>@<sha>`: the worktree kind's worktree.at_head, which commit-tracking automations use as
// their once_per key. The id may itself hold an '@', so the sha is what follows the last one.
const AT_HEAD = /^(.+)@([0-9a-f]{7,40})$/

export class MarkerStore {
  constructor(private readonly db: Database) {}

  // Worktree id → the head it was last handled through by <automationId>: the newest key that was
  // baselined (no run) or whose run finished well. Oldest first, so later rows win.
  progressMarkers(automationId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT h.once_key AS once_key FROM handled h LEFT JOIN runs r ON r.id = h.run_id
         WHERE h.automation_id = ?
           AND (h.run_id IS NULL OR h.status = 'done' OR r.status IN ('done', 'needs_you'))
         ORDER BY h.at, h.rowid`
      )
      .all(automationId) as { once_key: string }[]
    const markers = new Map<string, string>()
    for (const { once_key: key } of rows) {
      const match = AT_HEAD.exec(key)
      if (match) {
        markers.set(match[1], match[2])
      }
    }
    return markers
  }
}
