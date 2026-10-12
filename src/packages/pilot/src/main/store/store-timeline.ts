import type Database from '../../../../../main/sqlite/sync-database'
import type { Verdict } from '../../shared/api-types'
import type { InboxItemSummary } from '../../shared/inbox-types'
import { worktreePathKey, worktreePathSpellings } from '../fields/agent-activity'
import { toInboxSummary } from '../inbox/card'
import type { InboxStore } from './store-inbox'

export type NextRow = {
  automationId: string
  tickId: number
  tickAt: number
  itemKey: string
  label: string
  verdict: Verdict
  reason: string
}

export class TimelineStore {
  constructor(
    private readonly db: Database,
    private readonly inbox: InboxStore
  ) {}

  // Each automation's newest finished real tick, and only the items it recorded for this worktree. A tick still
  // running is skipped (its items aren't all in), and so is a dry run (it never moves anything). The path is
  // compared in worktreePathKey form, the form recordDecisions writes.
  nextFor(worktreePath: string): NextRow[] {
    return this.db
      .prepare(
        `SELECT t.automation_id, t.id AS tick_id, t.started_at, i.item_key, i.label, i.verdict, i.reason
         FROM tick_items i JOIN ticks t ON t.id = i.tick_id
         WHERE i.worktree_path = ? AND i.verdict <> 'out_of_scope'
           AND t.id = (SELECT MAX(t2.id) FROM ticks t2
                       WHERE t2.automation_id = t.automation_id AND t2.dry_run = 0 AND t2.status <> 'running')
         ORDER BY t.automation_id, i.rowid`
      )
      .all(worktreePathKey(worktreePath))
      .map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          automationId: String(r.automation_id),
          tickId: Number(r.tick_id),
          tickAt: Number(r.started_at),
          itemKey: String(r.item_key),
          label: String(r.label),
          verdict: r.verdict as Verdict,
          reason: String(r.reason)
        }
      })
  }

  // Open items about this worktree (under any spelling of its path), oldest first; for one person when given
  // (never anyone else's then).
  openInbox(worktreePath: string, person: string | null): InboxItemSummary[] {
    const where = { worktreePath: worktreePathSpellings(worktreePath), status: ['open' as const] }
    const filter = person === null ? where : { ...where, person }
    return this.inbox.list(filter).map(toInboxSummary)
  }

  // What these runs asked: still open, or answered and not yet done. One query for all of them.
  inboxForRuns(runIds: readonly string[]): InboxItemSummary[] {
    if (runIds.length === 0) {
      return []
    }
    return this.inbox.list({ runId: runIds, status: ['open', 'answered'] }).map(toInboxSummary)
  }
}
