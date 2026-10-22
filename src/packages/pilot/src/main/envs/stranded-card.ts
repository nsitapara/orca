import type { RunRow } from '../../shared/api-types'
import type { StrandedWork } from '../../shared/api-types-env'
import type { AutomationDefinition } from '../../shared/definition/types'
import { strandedWhat } from '../../shared/env-text'
import { addInboxItem } from '../inbox/inbox-add'
import { resolveInboxItem, type InboxDeps } from '../inbox/inbox-service'

// A throwaway Pilot can't remove that holds work nothing else has is loud: a flagged card on its run, so the run reads
// Needs you until the card closes. Its words leave out the try count, so every retry finds the same card unchanged.
// Returns the card's id, or null when it couldn't be written.
export function raiseStrandedCard(
  inbox: InboxDeps,
  def: AutomationDefinition | null,
  run: RunRow,
  work: StrandedWork,
  reason: string
): string | null {
  const what = strandedWhat(work)
  const job = def?.name ?? run.automationId
  return addInboxItem(inbox, {
    type: 'flagged',
    runId: run.id,
    title: `⚠ A fix is stuck in a throwaway Pilot can't remove: ${run.itemLabel}`,
    // A card's context is one line.
    context:
      `${job} run ${run.id} left ${what} in ${run.env?.path ?? 'its throwaway'}, and nothing else has it. ` +
      `Pilot can't remove the folder (${reason}), so nothing kept it on a pilot/ branch and job 15 can't merge it ` +
      `home. Pilot keeps trying; this card closes once the folder is removed and its work kept.`
  }).id
}

// The folder is removed (its work kept on a branch, or home already) or holds nothing any more: the card closes, and
// its run reads done again. A card already closed by hand is left as it is.
export function closeStrandedCard(inbox: InboxDeps, cardId: string, outcome: string): void {
  const item = inbox.store.inbox.get(cardId)
  if (item?.status !== 'open' && item?.status !== 'answered') {
    return
  }
  resolveInboxItem(inbox, cardId, outcome, 'done')
}
