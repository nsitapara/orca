// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import { queuedPreparation } from '../../../shared/preparation'

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
function serve(items: () => InboxListRow[], done: () => Promise<unknown> = async () => []) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return listOf(items())
    }
    if (method === 'pilot.queue.list') {
      return { entries: [] }
    }
    return method === 'pilot.runs.doneForYou' ? done() : {}
  })
}
const tabs = () => within(screen.getByRole('toolbar', { name: 'Card status' }))
// The list has answered and the page views as its first person.
const loaded = () =>
  waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Viewing as' })).toHaveProperty('value', 'nish')
  )

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
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preparation' }))
    await waitFor(() => expect(tabs().getByRole('button', { name: 'Preparing · 1' })).toBeTruthy())
    expect(tabs().getByRole('button', { name: 'Blocked · 0' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  const EMPTY = /^(Nothing waiting|Nothing is preparing|No preparation|No cards|Nothing done)/
  const failing = async (): Promise<never> => {
    throw new Error('down')
  }
  it.each<{
    case: string
    tab: InboxTab
    items?: InboxListRow[]
    search?: string
    done?: () => Promise<unknown>
    // Shown once the case has settled, before the empty text is read.
    settled?: string
    text: string | null
  }>([
    { case: 'Needs you', tab: 'needs_you', text: 'Nothing waiting on Nish here.' },
    { case: 'Preparing', tab: 'preparing', text: 'Nothing is preparing context.' },
    { case: 'Blocked', tab: 'blocked', text: 'No preparation is blocked.' },
    { case: 'All', tab: 'all', text: 'No cards here.' },
    {
      case: 'a search that hides every card',
      tab: 'needs_you',
      items: [QUESTION],
      search: 'zzz',
      text: 'No cards match these filters.'
    },
    { case: 'Done for you', tab: 'done', text: 'Nothing done for Nish here.' },
    {
      case: 'Done for you while its list errors',
      tab: 'done',
      done: failing,
      settled: "Done for you couldn't load: down",
      text: null
    },
    {
      case: 'Done for you before its list first loads',
      tab: 'done',
      done: () => new Promise(() => {}),
      text: null
    }
  ])('says what is empty: $case', async ({ tab, items = [], search, done, settled, text }) => {
    serve(() => items, done)
    setInboxViewPrefs({ tab })
    render(<InboxPage />)
    await loaded()
    if (search) {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search cards' }), {
        target: { value: search }
      })
    }
    if (settled) {
      await screen.findByText(settled)
    }
    if (text) {
      await screen.findByText(text)
    }
    expect(screen.queryAllByText(EMPTY).map((p) => p.textContent)).toEqual(text ? [text] : [])
  })
})
