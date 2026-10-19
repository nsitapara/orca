import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import { preparationRef, queuedPreparation } from '../../../shared/preparation'
import { MINI } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { LOCAL_PILOT_HOST, type PilotHostRef } from '../../hosts/pilot-host'
import { canTicketForLater } from './ticket-button'

const OPEN_FLAGGED = inboxRow({ type: 'flagged', status: 'open', itemKey: 'wt:7' })

describe('canTicketForLater', () => {
  it('offers Ticket for later on an open flagged card of this Pilot in the desktop app', () => {
    expect(canTicketForLater(OPEN_FLAGGED, LOCAL_PILOT_HOST, false)).toBe(true)
  })

  const queued = preparationRef(queuedPreparation({ key: 'k', context: 'c', requirements: [] }, 1))
  it.each<[string, Partial<InboxListRow>, PilotHostRef, boolean]>([
    ['answered', { status: 'answered' }, LOCAL_PILOT_HOST, false],
    ['an action card', { type: 'action', action: 'push' }, LOCAL_PILOT_HOST, false],
    ['no item key', { itemKey: null }, LOCAL_PILOT_HOST, false],
    ['never prepared', { needsEvidence: true }, LOCAL_PILOT_HOST, false],
    ['preparation still queued', { preparation: queued }, LOCAL_PILOT_HOST, false],
    ["another machine's card", {}, MINI, false],
    ['the web client', {}, LOCAL_PILOT_HOST, true]
  ])('refuses %s', (_why, over, host, web) => {
    expect(canTicketForLater({ ...OPEN_FLAGGED, ...over }, host, web)).toBe(false)
  })
})
