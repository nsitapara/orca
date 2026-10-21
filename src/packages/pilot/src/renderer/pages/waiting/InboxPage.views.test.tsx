// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import { TooltipProvider } from '@/components/ui/tooltip'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { pendingInboxCard, setPilotAutomationsView, showInboxCard } from '../automations-view'
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
const BUG = inboxRow({
  id: 'd',
  type: 'bug',
  title: 'Fourth',
  worktreePath: '/w/web-2',
  options: [
    { label: 'Approve', meaning: 'fix it' },
    { label: 'Skip', meaning: 'leave it' }
  ]
})
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
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'First' })
    fireEvent.click(view('One at a time'))
    view('One at a time').focus()
    fireEvent.keyDown(view('One at a time'), { key: 'j' })
    expect(screen.getByText('2 of 3')).toBeTruthy()
  })
})

describe('a card the run panel names', () => {
  it.each<[string, string, () => void]>([
    [
      'a kind chip',
      'd',
      () =>
        fireEvent.click(
          within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', {
            name: 'Questions · 3'
          })
        )
    ],
    [
      'a picked section',
      'c',
      () =>
        fireEvent.click(
          within(screen.getByRole('navigation', { name: 'Cards' })).getByRole('button', {
            name: 'web-1 · 2'
          })
        )
    ],
    ['the Rows view', 'c', () => fireEvent.click(view('Rows'))],
    ['the One at a time view', 'c', () => fireEvent.click(view('One at a time'))]
  ])('is shown and picked in Cards when hidden by %s', async (_name, id, hide) => {
    serve([...CARDS, BUG])
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'First' })
    hide()
    act(() => showInboxCard(id))
    await waitFor(() =>
      expect(document.getElementById(`card-${id}`)?.hasAttribute('data-selected')).toBe(true)
    )
    expect(view('Cards').getAttribute('aria-pressed')).toBe('true')
    expect(pendingInboxCard()).toBeNull()
    setPilotAutomationsView('automations')
  })
})

describe('Group by', () => {
  const nav = () => within(screen.getByRole('navigation', { name: 'Cards' }))
  const titles = () =>
    screen.queryAllByRole('article').map((a) => a.querySelector('h3')?.textContent)
  const groupBy = (value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value } })

  it('drops the picked section when it changes, so switching back shows every card', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'First' })
    fireEvent.click(nav().getByRole('button', { name: 'web-1 · 2' }))
    expect(titles()).toEqual(['First', 'Second'])
    groupBy('job')
    groupBy('worktree')
    expect(titles()).toEqual(['First', 'Second', 'Third'])
    expect(nav().getByRole('button', { name: 'All · 3' }).getAttribute('aria-pressed')).toBe('true')
  })
})
