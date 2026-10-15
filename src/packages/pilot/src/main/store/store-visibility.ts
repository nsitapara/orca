import type Database from '../../../../../main/sqlite/sync-database'

const LINEAR_ISSUE = /^https:\/\/linear\.app\/[^/]+\/issue\//

// Reads for Run visibility (spec §2, §3) that no other store owns.
export class VisibilityStore {
  constructor(private readonly db: Database) {}

  // The Linear issue URLs of the newest tick item that has one: where a ticket id's link comes from when its run
  // has none of its own.
  recentLinearUrls(): string[] {
    const row = this.db
      .prepare(
        "SELECT fields_json FROM tick_items WHERE fields_json LIKE '%linear.app/%/issue/%' ORDER BY rowid DESC LIMIT 1"
      )
      .get() as { fields_json: string } | undefined
    if (!row) {
      return []
    }
    const fields = JSON.parse(row.fields_json) as Record<string, unknown>
    return Object.values(fields).filter(
      (v): v is string => typeof v === 'string' && LINEAR_ISSUE.test(v)
    )
  }
}
