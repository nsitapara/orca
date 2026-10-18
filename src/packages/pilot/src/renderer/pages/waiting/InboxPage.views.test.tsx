// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

const question = (id: string, title: string, worktreePath: string): InboxListRow =>
  inboxRow({
    id,
    title,
    worktreePath,
    options: [
      { label: 'Yes', meaning: '' },
      { label: 'No', meaning: '' }
    ]
  })
const CARDS = [
  question('a', 'First', '/w/web-1'),
  question('b', 'Second', '/w/web-1'),
  question('c', 'Third', '/w/web-2')
]
const listOf = (items: InboxListRow[]): InboxListPayload => ({
  items,
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
})
function serve(items: InboxListRow[] = CARDS) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return listOf(items)
    }
    return method === 'pilot.queue.list' ? { entries: [] } : []
  })
}
const view = (name: string) => screen.getByRole('button', { name })

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('One at a time keys', () => {
  it('move the card while focus is still on the view button that opened it', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'First' })
    fireEvent.click(view('One at a time'))
    view('One at a time').focus()
    fireEvent.keyDown(view('One at a time'), { key: 'j' })
    expect(screen.getByText('2 of 3 in Needs you')).toBeTruthy()
  })
})
