// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'

function card(over: Partial<InboxItemRow>): InboxItemRow {
  return {
    id: 'in_1',
    automationId: 'tests',
    runId: 'r',
    stepIdx: 0,
    itemKey: null,
    worktreePath: null,
    person: 'nish',
    type: 'left_for_you',
    title: 't',
    context: '',
    options: [
      { label: 'Approve', meaning: 'fix it' },
      { label: 'Skip', meaning: 'leave it' }
    ],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    parts: {},
    switchWords: [],
    digest: 'd1',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  }
}
// Interleaved on purpose: a worktree card, an MR card, then another card of that worktree.
const F1 = card({
  id: 'f1',
  title: 'F1 Fixture',
  worktreePath: '/w/web-2099-carrier',
  createdAt: 5
})
const R1579 = card({
  id: 'r1579',
  title: 'Post your review of !1579?',
  itemKey: 'mr:1579',
  type: 'action',
  automationId: 'reviews'
})
const F2 = card({
  id: 'f2',
  title: 'F2 Rescind',
  worktreePath: '/w/web-2099-carrier',
  createdAt: 6
})
const JOB = card({ id: 'job', title: 'A job question', type: 'question', automationId: 'reviews' })
const LIST: InboxListPayload = {
  items: [F1, R1579, F2, JOB],
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [
    { id: 'tests', name: '04 · Test branch UIs overnight' },
    { id: 'reviews', name: '09 · Prepare reviews requested of me' }
  ],
  runLines: {}
}

function serve(list = LIST) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return list
    }
    if (method === 'pilot.queue.list') {
      return { entries: [] }
    }
    return { imported: 0, answers: 0, runs: 0, skipped: [], applied: false }
  })
}

describe('the Inbox layout', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('has a one-line header: list toggle, Inbox with its count, and the two dropdowns', async () => {
    serve()
    const { container } = render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const header = container.querySelector('header')!
    expect(
      within(header)
        .getByRole('button', { name: 'Hide the card list' })
        .getAttribute('aria-expanded')
    ).toBe('true')
    expect(within(header).getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(within(header).getByText('4 waiting')).toBeTruthy()
    expect(within(header).getByRole('combobox', { name: 'Viewing as' })).toBeTruthy()
    expect(within(header).getByRole('combobox', { name: 'Worktree filter' })).toBeTruthy()
    expect(header.textContent).not.toContain('Every automation leaves')
  })

  it('puts interleaved cards in sections, each under one sticky heading with its count', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const sections = screen.getAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'web-2099-carrier',
      '!1579',
      '09 · Prepare reviews requested of me'
    ])
    expect(
      within(sections[0])
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(['web-2099-carrier · 2', 'F1 Fixture', 'F2 Rescind'])
    expect(sections[0].querySelector('h3')?.className).toContain('sticky')
    expect(screen.queryByText('Job-wide')).toBeNull()
  })

  it('shows no worktree or group line on a card: the section heading carries it', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    expect(article.textContent).not.toContain('web-2099-carrier')
  })

  it('shows only the selected group, from the dropdown or from a heading in the list', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Worktree filter' }), {
      target: { value: 'mr:1579' }
    })
    expect(screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))).toEqual([
      '!1579'
    ])
    expect(screen.queryByRole('heading', { name: 'F1 Fixture' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Worktree filter' }), {
      target: { value: 'all' }
    })
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Cards' })).getByRole('button', {
        name: 'web-2099-carrier · 2'
      })
    )
    expect(screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))).toEqual([
      'web-2099-carrier'
    ])
  })

  it('lists the cards by the same groups: kind, job code, age, and the title', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const list = screen.getByRole('navigation', { name: 'Cards' })
    const headings = within(list)
      .getAllByRole('button')
      .filter((b) => !b.hasAttribute('data-row'))
      .map((b) => b.textContent)
    expect(headings).toEqual([
      'web-2099-carrier · 2',
      '!1579 · 1',
      '09 · Prepare reviews requested of me · 1'
    ])
    const row = list.querySelector('[data-row="f1"]')!
    expect(row.textContent).toContain('Left for you')
    expect(row.textContent).toContain('04')
    expect(row.textContent).toMatch(/\d+d/)
    expect(row.textContent).toContain('F1 Fixture')
  })

  it('selects a card from its row: highlights both and scrolls the card into view', async () => {
    serve()
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F2 Rescind' })
    const row = screen.getByRole('navigation', { name: 'Cards' }).querySelector('[data-row="f2"]')!
    fireEvent.click(row)
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(document.getElementById('card-f2')?.hasAttribute('data-selected')).toBe(true)
    expect(document.getElementById('card-f1')?.hasAttribute('data-selected')).toBe(false)
    expect(scroll).toHaveBeenCalled()
  })

  it('hides the list completely, and remembers the choice', async () => {
    serve()
    const { unmount } = render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.click(screen.getByRole('button', { name: 'Hide the card list' }))
    expect(screen.queryByRole('navigation', { name: 'Cards' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show the card list' }).getAttribute('aria-expanded')
    ).toBe('false')
    unmount()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    expect(screen.queryByRole('navigation', { name: 'Cards' })).toBeNull()
  })

  it('still works when storage throws', async () => {
    serve()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.click(screen.getByRole('button', { name: 'Hide the card list' }))
    expect(screen.queryByRole('navigation', { name: 'Cards' })).toBeNull()
    get.mockRestore()
    set.mockRestore()
  })
})

describe('the answer row', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('is a radiogroup of segmented options; arrow keys move the pick and its meaning shows beside them', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    const group = within(article).getByRole('radiogroup')
    const [approve, notes] = within(group).getAllByRole('radio')
    const save = article.querySelector('button[data-save]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(article.textContent).not.toContain('fix it')
    fireEvent.click(approve)
    expect(approve.getAttribute('aria-checked')).toBe('true')
    expect(article.textContent).toContain('fix it')
    expect(save.disabled).toBe(false)
    expect(save.className).toContain('bg-primary')
    fireEvent.keyDown(approve, { key: 'ArrowRight' })
    await waitFor(() => expect(notes.getAttribute('aria-checked')).toBe('true'))
    expect(article.textContent).toContain('say how it should be done')
    expect(approve.getAttribute('aria-checked')).toBe('false')
  })
})
