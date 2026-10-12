import { loadDetails } from './details-bundle'
import type { ImportPlan, PlannedBackfill } from './import-vault'
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
