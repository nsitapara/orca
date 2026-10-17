// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  runLines: {},
  answerStates: {}
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
    expect(within(header).queryByRole('combobox', { name: 'Worktree filter' })).toBeNull()
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
        .getAllByRole('heading')
        .map((h) => h.textContent)
    ).toEqual(['web-2099-carrier · 2', 'F1 Fixture', 'F2 Rescind'])
    expect(sections[0].querySelector('h2')?.className).toContain('sticky')
    expect(screen.queryByText('Job-wide')).toBeNull()
  })

  it('shows no worktree or group line on a card: the section heading carries it', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    expect(article.textContent).not.toContain('web-2099-carrier')
  })

  it('shows only the selected group, picked from a heading in the list, and All again', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const list = () => within(screen.getByRole('navigation', { name: 'Cards' }))
    const regions = () => screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))
    fireEvent.click(list().getByRole('button', { name: '!1579 · 1' }))
    expect(regions()).toEqual(['!1579'])
    expect(screen.queryByRole('heading', { name: 'F1 Fixture' })).toBeNull()
    fireEvent.click(list().getByRole('button', { name: 'All · 4' }))
    expect(regions()).toHaveLength(3)
    fireEvent.click(list().getByRole('button', { name: 'web-2099-carrier · 2' }))
    expect(regions()).toEqual(['web-2099-carrier'])
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
      'All · 4',
      'web-2099-carrier · 2',
      '!1579 · 1',
      '09 · Prepare reviews requested of me · 1'
    ])
    const row = list.querySelector('[data-row="f1"]')!
    expect(row.textContent).not.toContain('Left for you')
    expect(row.textContent).toContain('04')
    expect(row.textContent).toMatch(/\d+d|[A-Z][a-z]{2} \d+/)
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

  it('has one button per choice named for what it does, no Save button, and saves on the click', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    const group = within(article).getByRole('group', { name: 'Answer' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Skip', 'Fix it', 'With notes…'])
    expect(article.querySelector('button[data-save]')).toBeNull()
    expect(within(article).queryByRole('button', { name: 'Save answer' })).toBeNull()
    expect(within(article).queryByRole('radio')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Fix it' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'f1', text: 'approve', option: 0 })
      )
    )
  })

  it('shows an option’s description beside the row on hover, and as the tooltip', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    const fix = within(article).getByRole('button', { name: 'Fix it' })
    expect(fix.getAttribute('title')).toBe('fix it')
    fireEvent.mouseEnter(fix)
    expect(article.textContent).toContain('fix it')
    fireEvent.mouseLeave(fix)
    expect(within(article).getByRole('group', { name: 'Answer' }).textContent).not.toContain(
      'fix it'
    )
  })

  it('opens the notes box for “With notes…”, which needs Send, and Cancel closes it without saving', async () => {
    serve()
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: 'With notes…' }))
    const send = within(article).getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(article.querySelector('textarea')!, { target: { value: 'do it carefully' } })
    expect(send.disabled).toBe(false)
    expect(pilotRpc.mock.calls.some((c) => c[0] === 'pilot.inbox.answer')).toBe(false)
    fireEvent.click(within(article).getByRole('button', { name: 'Cancel' }))
    expect(article.querySelector('textarea')).toBeNull()
    expect(pilotRpc.mock.calls.some((c) => c[0] === 'pilot.inbox.answer')).toBe(false)
  })
})

describe('fix round 1', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('treats a selected group that has vanished as All, and shows the dropdown as All', async () => {
    let list = LIST
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return list
      }
      return method === 'pilot.queue.list' ? { entries: [] } : { imported: 0, skipped: [] }
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const nav = () => within(screen.getByRole('navigation', { name: 'Cards' }))
    fireEvent.click(nav().getByRole('button', { name: '!1579 · 1' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    list = { ...LIST, items: [F1, F2, JOB] }
    await vi.advanceTimersByTimeAsync(10_500)
    vi.useRealTimers()
    await waitFor(() => expect(screen.getAllByRole('region')).toHaveLength(2))
    expect(nav().getByRole('button', { name: 'All · 3' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/Nothing waiting/)).toBeNull()
  })

  it('shows only the selected group’s defaults, or none', async () => {
    const dWt = card({
      id: 'dw',
      type: 'default',
      title: 'Default in worktree',
      worktreePath: '/w/web-2099-carrier'
    })
    const dJob = card({
      id: 'dj',
      type: 'default',
      title: 'Default in job',
      automationId: 'reviews'
    })
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return { ...LIST, items: [F1, R1579, dWt, dJob] }
      }
      return method === 'pilot.queue.list' ? { entries: [] } : { imported: 0, skipped: [] }
    })
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.click(screen.getByText(/Defaults without a run/))
    expect(screen.getByRole('heading', { name: 'Default in job' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'web-2099-carrier · 1' }))
    expect(screen.getByRole('heading', { name: 'Default in worktree' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Default in job' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '!1579 · 1' }))
    expect(screen.queryByText(/Defaults without a run/)).toBeNull()
  })

  it('nests the headings: sections h2 above the card titles h3', async () => {
    serve()
    render(<InboxPage />)
    const title = await screen.findByRole('heading', { name: 'F1 Fixture' })
    expect(title.tagName).toBe('H3')
    expect(
      screen.getByRole('region', { name: 'web-2099-carrier' }).querySelector('h2')
    ).not.toBeNull()
  })

  it('shows the unsaved pill while notes are typed, and clears it on Cancel', async () => {
    serve({ ...LIST, items: [F1] })
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    const pill = () => [...article.querySelectorAll('span')].map((s) => s.textContent)
    fireEvent.click(within(article).getByRole('button', { name: 'With notes…' }))
    expect(pill()).toContain('unsaved')
    fireEvent.click(within(article).getByRole('button', { name: 'Cancel' }))
    expect(pill()).not.toContain('unsaved')
  })
})

let fireWidth: (w: number) => void = () => {}
class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    fireWidth = (w) =>
      act(() => cb([{ contentRect: { width: w } } as ResizeObserverEntry], this as never))
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('the filter by page width', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    vi.unstubAllGlobals()
  })
  const badges = () => screen.queryByRole('toolbar', { name: 'Filter by group' })
  const list = () => screen.queryByRole('navigation', { name: 'Cards' })

  it('on a wide page shows the list and no badges', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(1100)
    expect(list()).not.toBeNull()
    expect(badges()).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide the card list' })).toBeTruthy()
  })

  it('on a narrow page shows badges and no list, and no fold button', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(700)
    expect(list()).toBeNull()
    expect(screen.queryByRole('button', { name: /the card list/ })).toBeNull()
    const bar = within(badges()!)
    expect(bar.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All· 4',
      'web-2099-carrier· 2',
      '!1579· 1',
      '09 · Prepare reviews requested of me· 1'
    ])
    expect(bar.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    expect(bar.getByRole('button', { name: /^web-2099/ }).getAttribute('title')).toBe(
      'web-2099-carrier'
    )
  })

  it('with the list folded shows badges, and the fold button brings the list back', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(1100)
    fireEvent.click(screen.getByRole('button', { name: 'Hide the card list' }))
    expect(list()).toBeNull()
    expect(badges()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show the card list' }))
    expect(list()).not.toBeNull()
    expect(badges()).toBeNull()
  })

  it('filters on a badge click, highlighting the selected one', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(500)
    const badge = within(badges()!).getByRole('button', { name: /^!1579/ })
    fireEvent.click(badge)
    expect(screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))).toEqual([
      '!1579'
    ])
    expect(badge.getAttribute('aria-pressed')).toBe('true')
    expect(badge.className).toContain('bg-[var(--ib-accent-soft)]')
  })

  it('never lets a sticky element float transparent over the cards', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const heading = screen.getByRole('region', { name: 'web-2099-carrier' }).querySelector('h2')!
    for (const c of ['sticky', 'top-0', 'bg-background', 'z-20', 'border-b', '-mx-5']) {
      expect(heading.className).toContain(c)
    }
    const nav = list()!
    for (const c of [
      'sticky',
      'bg-background',
      'z-20',
      'self-start',
      'overflow-y-auto',
      'scrollbar-sleek'
    ]) {
      expect(nav.className).toContain(c)
    }
    fireWidth(500)
    expect(list()).toBeNull()
    expect(badges()!.className).not.toContain('sticky')
  })
})

describe('an MR group’s name on screen', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  it('shows the MR’s branch beside its iid in the list, the heading and the badges, truncated with the full text in title', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const named = { ...R1579, itemLabel: '!1579 web-2107-improve-reports-with-a-long-branch-name' }
    serve({ ...LIST, items: [named] })
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'Post your review of !1579?' })
    const full = '!1579 · web-2107-improve-reports-with-a-long-branch-name'
    const region = screen.getByRole('region', { name: full })
    expect(region.querySelector('h2')?.getAttribute('title')).toBe(full)
    expect(region.querySelector('h2')?.className).toContain('truncate')
    const nav = within(screen.getByRole('navigation', { name: 'Cards' }))
    expect(nav.getByRole('button', { name: `${full} · 1` }).getAttribute('title')).toBe(full)
    fireWidth(500)
    expect(within(screen.getByRole('toolbar')).getByTitle(full)).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('when the ask was made', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  const asked = new Date(2026, 9, 11, 2, 0).getTime()
  const eyebrowOf = async (item: InboxItemRow) => {
    serve({ ...LIST, items: [item] })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0))
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: item.title })).closest('article')!
    return { article, eyebrow: article.querySelector('[data-eyebrow]')! }
  }

  it('is a muted upper-case line above the title: job code and name, the date, the age', async () => {
    const { article, eyebrow } = await eyebrowOf({ ...F1, createdAt: asked })
    expect(eyebrow.textContent).toBe('04 · Test branch UIs overnight · Oct 11, 2:00 AM · 1d ago')
    for (const c of ['uppercase', 'text-muted-foreground', 'text-[11.5px]', 'tracking-[0.04em]']) {
      expect(eyebrow.className).toContain(c)
    }
    const line = eyebrow.firstElementChild!
    expect(line.className).toContain('truncate')
    expect(line.getAttribute('title')).toBe(eyebrow.textContent)
    expect(
      within(eyebrow as HTMLElement)
        .getByText('Oct 11, 2:00 AM')
        .getAttribute('title')
    ).toContain('2026')
    // Above the title, and nothing of it left in a chip row.
    const title = within(article).getByRole('heading', { name: 'F1 Fixture' })
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(article.textContent).not.toContain('Asked')
    // The list keeps the short age.
    expect(screen.getByRole('navigation', { name: 'Cards' }).textContent).toContain('1d')
    vi.useRealTimers()
  })

  it('has no waiting pill and no job chip, and says "drafted" on the right, in normal case', async () => {
    const { eyebrow } = await eyebrowOf({
      ...F1,
      createdAt: asked,
      details: { drafted: true } as never
    })
    const pills = [...eyebrow.querySelectorAll('span')].filter((s) => s.parentElement === eyebrow)
    expect(pills.map((p) => p.textContent)).toEqual([
      '04 · Test branch UIs overnight · Oct 11, 2:00 AM · 1d ago',
      'drafted'
    ])
    expect(pills[1].className).toContain('normal-case')
    expect(screen.queryByText('waiting')).toBeNull()
    expect(screen.queryAllByText('04 · Test branch UIs overnight')).toHaveLength(0)
    vi.useRealTimers()
  })

  it('shows a status pill only when the card is not plainly waiting (unsaved while notes are typed)', async () => {
    const { article, eyebrow } = await eyebrowOf({ ...F1, createdAt: asked })
    expect(eyebrow.textContent).not.toContain('waiting')
    fireEvent.click(within(article).getByRole('button', { name: 'With notes…' }))
    expect(eyebrow.textContent).toContain('unsaved')
    vi.useRealTimers()
  })
})

describe('the unsaved pill after Send', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  it('clears once the notes are sent', async () => {
    serve({ ...LIST, items: [F1] })
    render(<InboxPage />)
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: 'With notes…' }))
    fireEvent.change(article.querySelector('textarea')!, { target: { value: 'carefully' } })
    fireEvent.click(within(article).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'f1', text: 'carefully' })
      )
    )
    await waitFor(() =>
      expect([...article.querySelectorAll('span')].map((s) => s.textContent)).not.toContain(
        'unsaved'
      )
    )
  })
})
