// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListPayload } from '../../../shared/inbox-types'
import { queuedPreparation } from '../../../shared/preparation'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs, setInboxViewPrefs } from './inbox-view-prefs'

const QUEUED = queuedPreparation({ key: 'k', context: 'c', requirements: ['context'] }, 1)
const CARDS = [
  inboxRow({ id: 'a', title: 'First', worktreePath: '/w/web-1', preparation: QUEUED }),
  inboxRow({ id: 'b', title: 'Second', worktreePath: '/w/web-1', preparation: QUEUED })
]

function serve(waits: Partial<Pick<InboxListPayload, 'preparationWaits'>>) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return {
        items: CARDS,
        people: [{ id: 'nish', name: 'Nish Sitapara' }],
        groups: [],
        automations: [{ id: 'tests', name: 'Tests' }],
        answerStates: {},
        runLines: {},
        ...waits
      }
    }
    return method === 'pilot.queue.list' ? { entries: [] } : []
  })
}
const tabs = () => within(screen.getByRole('toolbar', { name: 'Card status' }))

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('the Preparing tab note', () => {
  it.each([
    [
      'one of two queued cards waits',
      { preparationWaits: { a: { code: 'typing', detail: 'x', since: 1 } } },
      true
    ],
    ['the host sends no waits (older Pilot)', {}, false]
  ])('when %s', async (_name, waits, shown) => {
    serve(waits)
    setInboxViewPrefs({ tab: 'preparing' })
    render(<InboxPage />)
    await waitFor(() => expect(tabs().getByRole('button', { name: 'Preparing · 2' })).toBeTruthy())
    expect(tabs().queryByText('1 waiting') !== null).toBe(shown)
  })
})
