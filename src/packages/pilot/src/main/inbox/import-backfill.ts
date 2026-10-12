import { loadDetails } from './details-bundle'
import { isDatable, type ImportPlan, type PlannedBackfill, type PlannedDate } from './import-vault'
import { setInboxDetails } from './inbox-details'
import type { InboxDeps } from './inbox-service'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function skippedRow(b: PlannedBackfill, reason: string): ImportPlan['skipped'][number] {
  const at = b.vaultRef.lastIndexOf('#')
  return { note: b.vaultRef.slice(0, at), key: b.vaultRef.slice(at + 1), summary: b.title, reason }
}

// The cards the import wrote before it carried bundles get theirs (after the new cards): a dry run counts
// each bundle Pilot would accept; applying sets it only on a card that, under the write lock, nobody has
// answered and no draft has given a bundle since the plan (setInboxDetails' onlyUnanswered and
// onlyWithoutDetails). Anything refused is skipped with the reason, and the card is left as it was.
export function backfillDetails(
  deps: InboxDeps,
  backfill: readonly PlannedBackfill[],
  opts: { dryRun?: boolean }
): { backfilled: number; skipped: ImportPlan['skipped'] } {
  const skipped: ImportPlan['skipped'] = []
  let backfilled = 0
  for (const b of backfill) {
    try {
      if (opts.dryRun) {
        loadDetails(deps.detailsRoot ?? null, b.path)
      } else {
        setInboxDetails(deps, b.id, b.path, {
          head: null,
          onlyUnanswered: true,
          onlyWithoutDetails: true
        })
      }
      backfilled += 1
    } catch (error) {
      skipped.push(skippedRow(b, `Details not attached: ${messageOf(error)}`))
    }
  }
  return { backfilled, skipped }
}

// The cards the import dated with the import time get the vault's ask date. Under the write, a card is
// re-read and changed only while it is still an open imported card dated later than the vault's time, so a
// card answered since the plan, or already corrected, is left alone (and a second run counts none).
export function fixDates(
  deps: InboxDeps,
  dates: readonly PlannedDate[],
  opts: { dryRun?: boolean }
): number {
  let fixed = 0
  for (const d of dates) {
    const item = deps.store.inbox.get(d.id)
    if (!isDatable(item, d.at)) {
      continue
    }
    if (!opts.dryRun) {
      deps.store.inbox.setCreatedAt(d.id, d.at)
    }
    fixed += 1
  }
  return fixed
}
