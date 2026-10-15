import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow } from '../../shared/api-types'
import { toRun } from './run-rows'

const ENDED = "('done', 'needs_you', 'failed', 'timed_out', 'cancelled')"
const LINEAR_ISSUE = /^https:\/\/linear\.app\/[^/]+\/issue\//

// Reads for Run visibility (spec §2, §3) that no other store owns.
export class VisibilityStore {
  constructor(private readonly db: Database) {}

  // The Linear issue URLs of the newest tick item that has one: where a ticket id's link comes from when its run
  // has none of its own. A row that only mentions a URL, or is corrupt, is skipped.
  recentLinearUrls(): string[] {
    const rows = this.db
      .prepare(
        "SELECT fields_json FROM tick_items WHERE fields_json LIKE '%linear.app/%/issue/%' ORDER BY rowid DESC LIMIT 20"
      )
      .all() as { fields_json: string }[]
    for (const row of rows) {
      const urls = issueUrls(row.fields_json)
      if (urls.length > 0) {
        return urls
      }
    }
    return []
  }

  // Ended runs since `since` nobody acknowledged, newest first (spec §3), read through V13's runs_unacknowledged.
  unacknowledged(
    automationIds: readonly string[] | null,
    since: number,
    limit: number,
    offset = 0
  ): RunRow[] {
    const only = automationIds
      ? ` AND automation_id IN (${automationIds.map(() => '?').join(', ') || 'NULL'})`
      : ''
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE acknowledged_at IS NULL AND status IN ${ENDED}
         AND COALESCE(finished_at, started_at) >= ?${only}
         ORDER BY COALESCE(finished_at, started_at) DESC LIMIT ? OFFSET ?`
      )
      .all(since, ...(automationIds ?? []), limit, offset)
      .map((r) => toRun(r as Record<string, unknown>))
  }

  // Got it: the ended runs it acknowledged now (one already acknowledged, still running or unknown isn't counted).
  acknowledge(runIds: readonly string[], at: number): string[] {
    const set = this.db.prepare(
      `UPDATE runs SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL AND status IN ${ENDED}`
    )
    return runIds.filter((id) => Number(set.run(at, id).changes) > 0)
  }
}

function issueUrls(json: string): string[] {
  try {
    const fields = JSON.parse(json) as Record<string, unknown>
    return Object.values(fields).filter(
      (v): v is string => typeof v === 'string' && LINEAR_ISSUE.test(v)
    )
  } catch {
    return []
  }
}
