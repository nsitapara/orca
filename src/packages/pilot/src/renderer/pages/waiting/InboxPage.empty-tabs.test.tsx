// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import { queuedPreparation } from '../../../shared/preparation'
import { TooltipProvider } from '@/components/ui/tooltip'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import type { InboxTab } from './inbox-tabs'
import { resetInboxViewPrefs, setInboxViewPrefs } from './inbox-view-prefs'

const QUEUED = queuedPreparation({ key: 'k', context: 'c', requirements: ['context'] }, 1)
const QUESTION = inboxRow({ id: 'q', title: 'Which image?', worktreePath: '/w/web-1' })
const listOf = (items: InboxListRow[]): InboxListPayload => ({
  items,
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
})
function serve(items: () => InboxListRow[]) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return listOf(items())
    }
    return method === 'pilot.queue.list' ? { entries: [] } : {}
  })
}
const tabs = () => within(screen.getByRole('toolbar', { name: 'Card status' }))
// The list has answered and the page views as its first person.
const loaded = () =>
  waitFor(() => expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.list', { person: 'nish' }))

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('an empty tab', () => {
  it('keeps Blocked, pressed, once a Retry moves its last card to Preparing', async () => {
    let retried = false
    const blocked = { ...QUEUED, state: 'blocked' as const }
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.prepareRetry') {
        retried = true
        return {}
      }
      if (method === 'pilot.inbox.list') {
        return listOf([{ ...QUESTION, preparation: retried ? QUEUED : blocked }])
      }
      return method === 'pilot.queue.list' ? { entries: [] } : []
    })
    setInboxViewPrefs({ tab: 'blocked' })
    render(<InboxPage />, { wrapper: TooltipProvider })
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preparation' }))
    await waitFor(() => expect(tabs().getByRole('button', { name: 'Preparing · 1' })).toBeTruthy())
    expect(tabs().getByRole('button', { name: 'Blocked · 0' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  const EMPTY = /^(Nothing waiting|Nothing is preparing|No preparation|No cards)/
  it.each<{ case: string; tab: InboxTab; text: string }>([
    { case: 'Needs you', tab: 'needs_you', text: 'Nothing waiting on Nish here.' },
    { case: 'Preparing', tab: 'preparing', text: 'Nothing is preparing context.' },
    { case: 'Blocked', tab: 'blocked', text: 'No preparation is blocked.' },
    { case: 'All', tab: 'all', text: 'No cards here.' }
  ])('says what is empty: $case', async ({ tab, text }) => {
    serve(() => [])
    setInboxViewPrefs({ tab })
    render(<InboxPage />, { wrapper: TooltipProvider })
    await loaded()
    await screen.findByText(text)
    expect(screen.queryAllByText(EMPTY).map((p) => p.textContent)).toEqual([text])
  })
})
