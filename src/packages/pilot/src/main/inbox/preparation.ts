import type { InboxItemRow } from '../../shared/api-types'
import { needsEvidence } from '../../shared/evidence'
import {
  PreparationInputSchema,
  queuedPreparation,
  requeuedPreparation,
  type PreparationInput
} from '../../shared/preparation'
import type { PreparationClaim } from '../store/store-inbox-preparations'
import { cardOf, inboxDigest } from './card'
import { loadDetails } from './details-bundle'
import { validatePreparationAction } from './preparation-action-evidence'
import { validatePreparationEvidence } from './details-preparation'
import { pushRangeProblems } from './push-range'
import { getInboxItem, inboxEvent, type InboxDeps } from './inbox-service'

export async function completePreparation(
  deps: InboxDeps,
  id: string,
  claim: PreparationClaim,
  bundlePath: string
) {
  const claimed = deps.store.inboxPreparations.requireClaim(id, claim, deps.now())
  const snapshot = loadDetails(deps.detailsRoot ?? null, bundlePath, { prepared: true })
  // Read-only git, outside the write: a revise (new args) moves the revision, so the claim re-check refuses it.
  const range = await pushRangeProblems(claimed, snapshot)
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
      ...validatePreparationAction(item, snapshot),
      ...range
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

export const RETRY_NOT_BLOCKED = 'Only a blocked preparation can be retried'

// A person's Retry on a blocked card: its preparation goes back in the queue with a new revision (so no claim on the
// old one counts) and fresh attempts. The caller check (a person, never an agent) is the RPC's.
export function retryPreparation(deps: InboxDeps, id: string) {
  return deps.store.transaction(() => {
    const item = getInboxItem(deps, id)
    const p = item.preparation
    if (item.status !== 'open' || p?.state !== 'blocked') {
      throw new Error(RETRY_NOT_BLOCKED)
    }
    const at = deps.now()
    deps.store.inboxPreparations.write(id, requeuedPreparation(p, at))
    inboxEvent(deps.store, item, 'item_updated', { reason: 'preparation_retry' }, at)
    return deps.store.inbox.get(id)
  })
}

export const NOT_PREPARABLE =
  'Only an open card that needs evidence and was never prepared can be prepared'

// A push card pins the commit it pushes: argv is [worktree, branch, head, base] (README, "A prepared push").
function pinnedHead(card: InboxItemRow): string | undefined {
  const argv = card.action === 'push' ? card.actionArgs?.argv : undefined
  const head = Array.isArray(argv) ? argv[2] : undefined
  return typeof head === 'string' && /^[0-9a-f]{7,40}$/.test(head) ? head : undefined
}

// The preparation request for a card that needs evidence but was never prepared (an imported or legacy push or
// drafted card), built from the card itself in the intake's shape (pilot_bridge.preparation_request).
export function evidenceRequest(card: InboxItemRow): PreparationInput {
  const requirements: PreparationInput['requirements'] = ['context', 'diff', 'checks']
  const request = {
    version: 1,
    ask: card.title,
    kind: card.type,
    context: card.context,
    recommendation: card.suggested,
    options: card.options.map((o) => (o.meaning ? `${o.label} — ${o.meaning}` : o.label)),
    action: card.action ? { name: card.action, args: card.actionArgs } : null,
    target: { worktree: card.worktreePath },
    sources: card.details ? [{ role: 'initial_details', path: card.details.path }] : [],
    recovery:
      'Rebuild the evidence this decision needs from the card itself: its title, context, pinned action and args, and Details.',
    origin: { runId: card.runId, step: card.stepIdx }
  }
  const head = pinnedHead(card)
  return PreparationInputSchema.parse({
    key: `evidence:${card.id}`,
    context: JSON.stringify(request),
    requirements,
    ...(head ? { head } : {})
  })
}

// A person's Prepare evidence (R-P5): the card is queued for job 14 with its own request. The caller check (the
// desktop or a paired device, never an agent) is the RPC's.
export function prepareEvidence(deps: InboxDeps, id: string) {
  return deps.store.transaction(() => {
    const card = getInboxItem(deps, id)
    if (card.status !== 'open' || card.preparation || !needsEvidence(card)) {
      throw new Error(NOT_PREPARABLE)
    }
    const at = deps.now()
    deps.store.inboxPreparations.write(id, queuedPreparation(evidenceRequest(card), at))
    inboxEvent(deps.store, card, 'item_updated', { reason: 'evidence_requested' }, at)
    return deps.store.inbox.get(id)
  })
}
