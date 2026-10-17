import { EVIDENCE_ACTIONS, needsEvidence } from '../../../shared/evidence'
import { queuedPreparation } from '../../../shared/preparation'
import type { InboxAddParams, InboxAddResult } from '../../../shared/inbox-types'
import type { PilotStore } from '../../store/store'
import { addInboxItem } from '../inbox-add'
import type { InboxDeps } from '../inbox-service'

// R-P5 in tests of the action machinery: a push card is added as today's producers add it (with a
// preparation request) and made ready, as job 14's verified completion leaves it.
export const TEST_EVIDENCE = {
  key: 'test-evidence',
  context: 'Evidence prepared for the test',
  requirements: ['context' as const]
}

export function asPrepared(params: InboxAddParams): InboxAddParams {
  const evidence = params.action !== undefined && EVIDENCE_ACTIONS.has(params.action)
  return evidence && !params.preparation ? { ...params, preparation: TEST_EVIDENCE } : params
}

// A card whose decision needs evidence (a push, a drafted change) made prepared and ready.
export function markReady(store: PilotStore, id: string): void {
  const card = store.inbox.get(id)
  if (!card || !needsEvidence(card)) {
    return
  }
  const p = card.preparation ?? queuedPreparation(TEST_EVIDENCE, 1)
  if (p.state !== 'ready') {
    store.inboxPreparations.write(id, { ...p, state: 'ready', progress: 'Ready for your decision' })
  }
}

export function addReady(
  deps: InboxDeps,
  params: InboxAddParams,
  opts?: Parameters<typeof addInboxItem>[2]
): InboxAddResult {
  const added = addInboxItem(deps, asPrepared(params), opts)
  if (added.id) {
    markReady(deps.store, added.id)
  }
  return added
}
