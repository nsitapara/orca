// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import { TooltipProvider } from '@/components/ui/tooltip'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { registerPilotStore, type PilotStoreState } from '../../store'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

// Worktree sections sort by name, so web-platform's alpha and gamma come either side of pilot's beta.
const CARDS: InboxListRow[] = [
  inboxRow({ id: 'a', title: 'In alpha', worktreePath: '/r/web/alpha' }),
  inboxRow({ id: 'b', title: 'In beta', worktreePath: '/wt/pilot/beta' }),
  inboxRow({ id: 'g', title: 'In gamma', worktreePath: '/r/web/gamma' }),
  inboxRow({ id: 'm', title: 'On the MR', itemKey: 'mr:1579' })
]
const LIST: InboxListPayload = {
  items: CARDS,
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: '04 · Test branch UIs overnight' }],
  answerStates: {},
  runLines: {}
}

const nav = () => within(screen.getByRole('navigation', { name: 'Cards' }))
const regions = () => screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))

beforeEach(() => {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return LIST
    }
    return method === 'pilot.queue.list' ? { entries: [] } : []
  })
  // The app lists alpha and gamma under web-platform; beta it doesn't list, so its parent folder names it.
  const state: PilotStoreState = {
    rightSidebarOpen: false,
    setRightSidebarOpen: () => {},
    worktreesByRepo: {
      'repo-1': [
        { id: 'repo-1::/r/web/alpha', path: '/r/web/alpha' },
        { id: 'repo-1::/r/web/gamma', path: '/r/web/gamma' }
      ]
    },
    repos: [{ id: 'repo-1', displayName: 'web-platform' }]
  }
  registerPilotStore({ getState: () => state })
})
afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  registerPilotStore(null)
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('cards by project', () => {
  it('keeps a project’s worktrees together in the list and the cards, with the cards no worktree holds last', async () => {
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'In alpha' })
    expect(
      nav()
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label'))
    ).toEqual(['Kind', 'web-platform', 'pilot', 'Not in a worktree'])
    expect(regions()).toEqual(['alpha', 'gamma', 'beta', '!1579'])
    const web = screen
      .getAllByRole('group', { name: 'web-platform' })
      .find((g) => !g.closest('nav'))!
    expect(web.textContent).toContain('2 worktrees · 2 cards')
    // Pinned, a worktree's heading still says which project it is in.
    expect(
      within(web)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent)
    ).toEqual(['web-platform / alpha · 1', 'web-platform / gamma · 1'])
  })

  it('pins each project and worktree heading on a solid background, the worktree’s below its project’s', async () => {
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'In alpha' })
    const project = nav().getByRole('button', { name: 'web-platform · 2' })
    for (const c of ['sticky', 'top-0', 'bg-muted']) {
      expect(project.className).toContain(c)
    }
    const worktree = nav().getByRole('button', { name: 'alpha · 1' }).parentElement!
    for (const c of ['sticky', 'top-8', 'bg-background']) {
      expect(worktree.className).toContain(c)
    }
  })

  it('folds a project in the list without hiding its cards, and opens it again', async () => {
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'In alpha' })
    const project = nav().getByRole('button', { name: 'web-platform · 2' })
    fireEvent.click(project)
    expect(project.getAttribute('aria-expanded')).toBe('false')
    expect(nav().queryByRole('button', { name: 'alpha · 1' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'In alpha' })).toBeTruthy()
    fireEvent.click(project)
    expect(nav().getByRole('button', { name: 'alpha · 1' })).toBeTruthy()
  })

  it('still shows only the worktree picked in the list, under its project', async () => {
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'In alpha' })
    fireEvent.click(nav().getByRole('button', { name: 'gamma · 1' }))
    expect(regions()).toEqual(['gamma'])
    expect(screen.getByText('1 worktree · 1 card')).toBeTruthy()
  })
})
