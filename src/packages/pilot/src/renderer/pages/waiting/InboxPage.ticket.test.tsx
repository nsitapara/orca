// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import type { TicketDraft } from '../../../shared/ticket-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

const EARLIER = { identifier: 'WEB-9', url: 'https://linear.app/herasight/issue/WEB-9' }
const FINDING: InboxListRow = {
  ...inboxRow({
    id: 'in_f',
    type: 'flagged',
    title: 'Footer overlaps Save',
    itemKey: 'wt:7',
    options: [
      { label: 'Fix it', meaning: 'start the fix' },
      { label: 'Skip', meaning: 'leave it' }
    ]
  }),
  ticketedBefore: EARLIER
}
const DRAFT: TicketDraft = {
  title: 'Footer overlaps Save',
  body: 'body',
  team: 'WEB',
  state: 'Backlog',
  priority: 'low',
  labels: [],
  assignee: 'me',
  images: [],
  link: null,
  ticketedBefore: EARLIER,
  templatePath: '/t.md',
  digest: 'd1'
}
const LIST: InboxListPayload = {
  items: [FINDING],
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
}

const lists = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.list').length

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('Ticket for later on an Inbox card', () => {
  it('sits after Skip, opens its draft in place of the row, and reloads once filed', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return LIST
      }
      if (method === 'pilot.inbox.ticketDraft') {
        return DRAFT
      }
      if (method === 'pilot.inbox.ticketForLater') {
        return { ok: true, identifier: 'WEB-1482', url: 'https://linear.app/x/WEB-1482' }
      }
      return { entries: [] }
    })
    render(<InboxPage />)
    const card = (await screen.findByRole('heading', { name: 'Footer overlaps Save' })).closest(
      'article'
    )!
    expect(within(card).getByRole('link', { name: 'Ticketed before · WEB-9' })).toBeTruthy()
    const row = within(card).getByRole('group', { name: 'Answer' })
    const labels = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(labels.slice(0, 2)).toEqual(['Skip', 'Ticket for later'])
    fireEvent.click(within(row).getByRole('button', { name: 'Ticket for later' }))
    await within(card).findByDisplayValue('Footer overlaps Save')
    expect(within(card).queryByRole('group', { name: 'Answer' })).toBeNull()
    const before = lists()
    fireEvent.click(within(card).getByRole('button', { name: 'Create WEB ticket' }))
    await waitFor(() => expect(lists()).toBeGreaterThan(before))
    expect(await within(card).findByRole('group', { name: 'Answer' })).toBeTruthy()
  })
})
