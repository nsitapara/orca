import type { PreparationClaim } from '../store/store-inbox-preparations'
import { cardOf, inboxDigest } from './card'
import { loadDetails } from './details-bundle'
import { validatePreparationAction } from './preparation-action-evidence'
import { validatePreparationEvidence } from './details-preparation'
import { inboxEvent, type InboxDeps } from './inbox-service'

export function completePreparation(
  deps: InboxDeps,
  id: string,
  claim: PreparationClaim,
  bundlePath: string
) {
  deps.store.inboxPreparations.requireClaim(id, claim, deps.now())
  const snapshot = loadDetails(deps.detailsRoot ?? null, bundlePath, { prepared: true })
  return deps.store.transaction(() => {
    const at = deps.now()
    const item = deps.store.inboxPreparations.requireClaim(id, claim, at)
    const provenance = snapshot.bundle.provenance
    if (
      !provenance ||
      provenance.itemId !== id ||
      provenance.preparingRunId !== claim.runId ||
      provenance.originatingRunId !== item.runId ||
      provenance.attempt !== claim.attempt
    ) {
      throw new Error('Evidence provenance does not match the active preparation attempt')
    }
    const errors = [
      ...validatePreparationEvidence(snapshot, item.preparation.input.requirements),
      ...validatePreparationAction(item, snapshot)
    ]
    if (errors.length) {
      throw new Error(`Context incomplete: ${errors.join('; ')}`)
    }
    if (snapshot.ref.artifacts) {
      snapshot.ref.artifacts.expected = [...item.preparation.input.requirements]
    }
    const card = { ...cardOf(item), details: snapshot.ref, detailsMd: null }
    deps.store.inbox.edit(
      id,
      { details: snapshot.ref, detailsMd: null, digest: inboxDigest(card) },
      at
    )
    deps.store.inbox.setSnapshot(id, snapshot)
    deps.store.inboxPreparations.write(id, {
      ...item.preparation,
      state: 'ready',
      progress: 'Ready for your decision',
      error: null,
      leaseUntil: null,
      updatedAt: at
    })
    inboxEvent(
      deps.store,
      item,
      'item_updated',
      { reason: 'context_ready', attempt: claim.attempt },
      at
    )
    return deps.store.inbox.get(id)
  })
}
