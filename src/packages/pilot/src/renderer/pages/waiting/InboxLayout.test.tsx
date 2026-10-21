// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { AnswerState, InboxListPayload } from '../../../shared/inbox-types'
import { queuedPreparation } from '../../../shared/preparation'
import { TooltipProvider } from '@/components/ui/tooltip'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

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

// A list button that picks a section: not a card's row, nor the Kind section's.
const isSectionButton = (b: HTMLElement) =>
  !b.hasAttribute('data-row') && !b.closest('[aria-label="Kind"]')

// Tabs and grouping persist in a module cache and storage; each test starts from the defaults.
beforeEach(() => {
  window.localStorage.clear()
  resetInboxViewPrefs()
})

describe('the Inbox layout', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('has a one-row header beside the list: toggle, Inbox and the view controls, kinds in the list, no status tabs', async () => {
    serve()
    const { container } = render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const header = within(container.querySelector('header')!)
    expect(
      header.getByRole('button', { name: 'Hide the card list' }).getAttribute('aria-expanded')
    ).toBe('true')
    expect(header.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Card status' })).toBeNull()
    expect(header.getByRole('combobox', { name: 'Group by' })).toBeTruthy()
    expect(header.getByRole('group', { name: 'View' })).toBeTruthy()
    expect(
      within(screen.getByRole('navigation', { name: 'Cards' })).getByRole('group', { name: 'Kind' })
    ).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Viewing as' })).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('puts interleaved cards in sections; only a job section has a heading, sticky with its count', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const sections = screen.getAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'web-2099-carrier',
      '!1579',
      '09 · Prepare reviews requested of me'
    ])
    expect(sections.map((s) => s.querySelector('h2')?.textContent ?? null)).toEqual([
      null,
      null,
      '09 · Prepare reviews requested of me · 1'
    ])
    expect(sections[2].querySelector('h2')?.className).toContain('sticky')
    expect(
      within(sections[0])
        .getAllByRole('heading')
        .map((h) => h.textContent)
    ).toEqual(['F1 Fixture', 'F2 Rescind'])
    expect(screen.queryByText('Job-wide')).toBeNull()
  })

  it('opens each card of a worktree or MR on its place, inside the card', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const place = (id: string) =>
      document.getElementById(`card-${id}`)?.querySelector('[data-card-place]')?.textContent ?? null
    expect([place('f1'), place('f2'), place('r1579'), place('job')]).toEqual([
      'w/web-2099-carrier',
      'w/web-2099-carrier',
      '!1579',
      null
    ])
  })

  it('shows only the group picked from a heading in the list, and every group once it is picked again', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const list = () => within(screen.getByRole('navigation', { name: 'Cards' }))
    const regions = () => screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))
    fireEvent.click(list().getByRole('button', { name: '!1579 · 1' }))
    expect(regions()).toEqual(['!1579'])
    expect(screen.queryByRole('heading', { name: 'F1 Fixture' })).toBeNull()
    expect(list().getByRole('button', { name: '!1579 · 1' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    fireEvent.click(list().getByRole('button', { name: '!1579 · 1' }))
    expect(regions()).toHaveLength(3)
    fireEvent.click(list().getByRole('button', { name: 'web-2099-carrier · 2' }))
    expect(regions()).toEqual(['web-2099-carrier'])
  })

  it('lists the cards by the same groups, under their projects: the job, age, and the title', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const list = screen.getByRole('navigation', { name: 'Cards' })
    const headings = within(list)
      .getAllByRole('button')
      .filter(isSectionButton)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(headings).toEqual([
      'w · 2',
      'web-2099-carrier · 2',
      'Not in a worktree · 2',
      '!1579 · 1',
      '09 · Prepare reviews requested of me · 1'
    ])
    const row = list.querySelector('[data-row="f1"]')!
    expect(row.textContent).not.toContain('Left for you')
    expect(row.textContent).toContain('04 · Test branch UIs overnight')
    expect(row.textContent).toMatch(/\d+d|[A-Z][a-z]{2} \d+/)
    expect(row.textContent).toContain('F1 Fixture')
  })

  it('selects a card from its row: highlights both and scrolls the card into view', async () => {
    serve()
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    const { unmount } = render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.click(screen.getByRole('button', { name: 'Hide the card list' }))
    expect(screen.queryByRole('navigation', { name: 'Cards' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show the card list' }).getAttribute('aria-expanded')
    ).toBe('false')
    unmount()
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    render(<InboxPage />, { wrapper: TooltipProvider })
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

  it('shows an option’s description under the row on hover, and as the tooltip', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    const fix = within(article).getByRole('button', { name: 'Fix it' })
    expect(fix.getAttribute('title')).toBe('fix it')
    // The hint holds its space outside the button row, so showing it never moves the buttons.
    const hint = within(article).getByText('fix it')
    expect(within(article).getByRole('group', { name: 'Answer' }).contains(hint)).toBe(false)
    expect(hint.classList.contains('invisible')).toBe(true)
    fireEvent.mouseEnter(fix)
    expect(hint.classList.contains('invisible')).toBe(false)
    fireEvent.mouseLeave(fix)
    expect(hint.classList.contains('invisible')).toBe(true)
  })

  it('opens the notes box for “With notes…”, which needs Send, and Cancel closes it without saving', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const nav = () => within(screen.getByRole('navigation', { name: 'Cards' }))
    fireEvent.click(nav().getByRole('button', { name: '!1579 · 1' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    list = { ...LIST, items: [F1, F2, JOB] }
    await vi.advanceTimersByTimeAsync(10_500)
    vi.useRealTimers()
    await waitFor(() => expect(screen.getAllByRole('region')).toHaveLength(2))
    expect(screen.queryByText(/Nothing waiting/)).toBeNull()
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
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(1100)
    expect(list()).not.toBeNull()
    expect(badges()).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide the card list' })).toBeTruthy()
  })

  it('on a narrow page shows badges and no list, no fold button, and the kinds and view controls under the header', async () => {
    serve()
    const { container } = render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireWidth(700)
    expect(list()).toBeNull()
    expect(screen.queryByRole('button', { name: /the card list/ })).toBeNull()
    const header = container.querySelector('header')!
    for (const control of [
      screen.getByRole('group', { name: 'Kind' }),
      screen.getByRole('combobox', { name: 'Group by' })
    ]) {
      expect(header.contains(control)).toBe(false)
    }
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
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    render(<InboxPage />, { wrapper: TooltipProvider })
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
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const heading = () =>
      screen
        .getByRole('region', { name: '09 · Prepare reviews requested of me' })
        .querySelector('h2')!
    for (const c of ['sticky', 'top-0', 'bg-background', 'z-20', 'border-b', '-mr-5']) {
      expect(heading().className).toContain(c)
    }
    // It stops short of the list beside it, and runs to the page's edge once the list is gone.
    expect(heading().className).not.toContain('-ml-5')
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
    expect(heading().className).toContain('-ml-5')
    expect(badges()!.className).not.toContain('sticky')
  })
})

describe('an MR group’s name on screen', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  it('shows the MR’s branch beside its iid in the list, the card and the badges, truncated with the full text in title', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const named = { ...R1579, itemLabel: '!1579 web-2107-improve-reports-with-a-long-branch-name' }
    serve({ ...LIST, items: [named] })
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'Post your review of !1579?' })
    const full = '!1579 · web-2107-improve-reports-with-a-long-branch-name'
    const region = screen.getByRole('region', { name: full })
    const name = within(region.querySelector<HTMLElement>('[data-card-place]')!).getByText(full)
    expect(name.getAttribute('title')).toBe(full)
    // The name truncates, not the chips beside it.
    expect(name.className).toContain('truncate')
    const nav = within(screen.getByRole('navigation', { name: 'Cards' }))
    expect(nav.getByRole('button', { name: `${full} · 1` }).getAttribute('title')).toBe(full)
    fireWidth(500)
    expect(
      within(screen.getByRole('toolbar', { name: 'Filter by group' })).getByTitle(full)
    ).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('when the ask was made', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  const asked = new Date(2026, 9, 11, 2, 0).getTime()
  const jobLineOf = async (item: InboxItemRow, history?: InboxListPayload['history']) => {
    serve({ ...LIST, items: [item], history })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0))
    render(<InboxPage />, { wrapper: TooltipProvider })
    const article = (await screen.findByRole('heading', { name: item.title })).closest('article')!
    const jobLine = article.querySelector<HTMLElement>('[data-job-line]')!
    const times = jobLine.querySelector<HTMLElement>('[data-card-times]')!
    return { article, jobLine, times }
  }

  it('opens on a job line above the title: the code apart, then the name, whole in its title', async () => {
    const { article, jobLine } = await jobLineOf({ ...F1, createdAt: asked })
    const [code, name] = [...jobLine.children]
    expect([code.textContent, name.textContent]).toEqual(['04', 'Test branch UIs overnight'])
    expect(name.className).toContain('truncate')
    expect(name.getAttribute('title')).toBe('04 · Test branch UIs overnight')
    const title = within(article).getByRole('heading', { name: 'F1 Fixture' })
    expect(jobLine.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(article.textContent).not.toContain('Asked')
    // The list keeps the short age.
    expect(screen.getByRole('navigation', { name: 'Cards' }).textContent).toContain('1d')
    vi.useRealTimers()
  })

  it('says on it how old the card is, the full date and year in the title', async () => {
    const { times } = await jobLineOf({ ...F1, createdAt: asked })
    expect([...times.children].map((c) => c.textContent)).toEqual(['1d ago'])
    expect(times.firstElementChild!.getAttribute('title')).toMatch(/^Created .*October 11, 2026/)
    vi.useRealTimers()
  })

  it("adds when the agent last replied, not Pilot's later line", async () => {
    const reply = (hour: number, by: 'agent' | 'pilot') => ({
      kind: 'reply' as const,
      at: new Date(2026, 9, 12, hour, 0).getTime(),
      by,
      text: `${by} at ${hour}`,
      run: null
    })
    const { times } = await jobLineOf(
      { ...F1, createdAt: asked },
      {
        f1: [
          { kind: 'asked', at: asked, run: null },
          reply(9, 'agent'),
          reply(11, 'agent'),
          reply(11, 'pilot')
        ]
      }
    )
    expect([...times.children].map((c) => c.textContent)).toEqual([
      '1d ago',
      '· agent replied 1h ago'
    ])
    vi.useRealTimers()
  })

  it('has no waiting pill and says "drafted" on the right, the job named once', async () => {
    const { article, jobLine, times } = await jobLineOf({
      ...F1,
      createdAt: asked,
      details: { drafted: true } as never
    })
    const drafted = within(jobLine).getByText('drafted')
    expect(drafted.className).toContain('normal-case')
    expect(times.compareDocumentPosition(drafted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('waiting')).toBeNull()
    expect(within(article).queryAllByText('Test branch UIs overnight')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('shows a status pill only when the card is not plainly waiting (unsaved while notes are typed)', async () => {
    const { article, jobLine } = await jobLineOf({ ...F1, createdAt: asked })
    expect(jobLine.textContent).not.toContain('waiting')
    fireEvent.click(within(article).getByRole('button', { name: 'With notes…' }))
    expect(jobLine.textContent).toContain('unsaved')
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
    render(<InboxPage />, { wrapper: TooltipProvider })
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

describe('every card in one list', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  const QUEUED = card({
    id: 'queued',
    title: 'Still preparing',
    worktreePath: '/w/web-3000',
    preparation: queuedPreparation({ key: 'k', context: 'c', requirements: ['context'] }, 1)
  })
  const UNLOCKED: AnswerState = {
    locked: false,
    sentBeforePilot: false,
    state: 'not_ready',
    readyAt: null,
    reason: null
  }
  const nav = () => screen.getByRole('navigation', { name: 'Cards' })
  const row = (id: string) => nav().querySelector(`[data-row="${id}"]`)!
  const cardTitles = () =>
    screen.queryAllByRole('article').map((a) => a.querySelector('h3')?.textContent)
  const groupBy = (value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value } })

  it('lists the ready cards and the one still preparing together; the list counts them all', async () => {
    serve({ ...LIST, items: [F1, F2, QUEUED] })
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    expect(cardTitles()).toEqual(['F1 Fixture', 'F2 Rescind', 'Still preparing'])
    expect(within(nav()).getByRole('button', { name: 'All · 3' })).toBeTruthy()
  })

  it('keeps a card just answered on screen, with its Undo, while the answer can be taken back', async () => {
    let answered = false
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        const f1: InboxItemRow = answered
          ? {
              ...F1,
              status: 'answered',
              answer: { option: 0, text: 'approve', digest: 'd1', via: 'page' }
            }
          : F1
        return { ...LIST, items: [f1], answerStates: answered ? { f1: UNLOCKED } : {} }
      }
      if (method === 'pilot.inbox.answer') {
        answered = true
        return { status: 'answered' }
      }
      return method === 'pilot.queue.list' ? { entries: [] } : []
    })
    render(<InboxPage />, { wrapper: TooltipProvider })
    const article = (await screen.findByRole('heading', { name: 'F1 Fixture' })).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: 'Fix it' }))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('forgets the picked card once a kind filter hides it', async () => {
    serve({ ...LIST, items: [F1, JOB] })
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    fireEvent.click(row('f1'))
    expect(document.getElementById('card-f1')?.hasAttribute('data-selected')).toBe(true)
    fireEvent.click(within(nav()).getByRole('button', { name: 'Questions · 1' }))
    fireEvent.click(within(nav()).getByRole('button', { name: 'Questions · 1' }))
    expect(document.getElementById('card-f1')?.hasAttribute('data-selected')).toBe(false)
    expect(row('f1').getAttribute('aria-current')).toBeNull()
  })

  it('groups by job: the headings name the jobs, and each list row and card names its project and worktree', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    const place = (id: string) =>
      document.getElementById(`card-${id}`)?.querySelector('[data-card-place]')?.textContent ?? null
    expect(row('f1').textContent).not.toContain('web-2099-carrier')
    groupBy('job')
    expect(screen.getAllByRole('region').map((s) => s.querySelector('h2')?.textContent)).toEqual([
      '04 · Test branch UIs overnight · 2',
      '09 · Prepare reviews requested of me · 2'
    ])
    expect(row('f1').textContent).toContain('w / web-2099-carrier')
    expect(row('r1579').textContent).toContain('!1579')
    expect([place('f1'), place('r1579'), place('job')]).toEqual([
      'w/web-2099-carrier',
      '!1579',
      null
    ])
  })

  it('groups by nothing: one section with no heading, and no blank group in the list', async () => {
    serve()
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'F1 Fixture' })
    groupBy('none')
    // Named apart from the "Cards" list beside it.
    expect(screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))).toEqual([
      'All cards'
    ])
    expect(screen.getByRole('region', { name: 'All cards' }).querySelector('h2')).toBeNull()
    expect(
      within(nav())
        .getAllByRole('button')
        .filter(isSectionButton)
        .map((b) => b.textContent)
    ).toEqual([])
  })
})
