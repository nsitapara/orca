// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { QueueEntry } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'

const NOW = 1_800_000_000_000
const CARD = {
  id: 'in_a',
  automationId: 'reviews',
  runId: 'r',
  stepIdx: 0,
  itemKey: 'mr:1579',
  worktreePath: null,
  person: 'nish',
  type: 'action',
  title: 'Post your review of !1579?',
  context: '',
  options: [
    { label: 'Approve', meaning: 'post' },
    { label: 'Skip', meaning: 'leave it' }
  ],
  suggested: null,
  detailsMd: null,
  details: null,
  action: 'post_review',
  actionArgs: { argv: ['1579'] },
  parts: {},
  switchWords: [],
  digest: 'dig1',
  version: 2,
  status: 'answered',
  answer: { option: 0, text: 'approve', digest: 'dig1', via: 'page' },
  answeredAt: NOW,
  answeredBy: 'nish',
  replies: [],
  outcome: null,
  createdAt: 1,
  updatedAt: NOW,
  source: 'engine',
  vaultRef: null
} as unknown as InboxItemRow
const entry = (over: Partial<QueueEntry>): QueueEntry =>
  ({
    rowId: 1,
    itemId: 'in_a',
    title: 't',
    type: 'action',
    automationId: 'reviews',
    automationName: 'Reviews',
    worktreePath: null,
    person: 'nish',
    answer: 'approve',
    state: 'not_ready',
    holdReason: null,
    holdDetail: null,
    readyAt: NOW + 179_000,
    how: 'script',
    fires: 'Run post_review; no agent',
    updatedAt: NOW,
    ...over
  }) as QueueEntry

function serve(item: InboxItemRow, queue: QueueEntry[]) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return {
        items: [item],
        people: [{ id: 'n', name: 'N' }],
        groups: [],
        automations: [],
        runLines: {}
      }
    }
    if (method === 'pilot.queue.list') {
      return { entries: queue }
    }
    return { imported: 0, skipped: [] }
  })
}

describe('an answered card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  it('is one line counting down to the settle time, with Undo; it does not count as waiting', async () => {
    serve(CARD, [entry({})])
    const { container } = render(<InboxPage />)
    expect(await screen.findByText('Post review in 2:59')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(container.textContent).toContain('0 waiting')
    expect(screen.queryByRole('button', { name: 'Post review' })).toBeNull()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(screen.getByText('Post review in 2:56')).toBeTruthy()
  })

  it('Undo clears the answer through the same save, with no words and the card’s digest', async () => {
    serve(CARD, [entry({})])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({
          id: 'in_a',
          text: '',
          digest: 'dig1',
          by: 'n'
        })
      )
    )
  })

  it.each([
    ['no queue row (it was dispatched)', [] as QueueEntry[]],
    ['a ready row', [entry({ state: 'ready', readyAt: NOW - 1000 })]],
    ['a row whose settle time has passed', [entry({ readyAt: NOW - 1 })]]
  ])('says what is being done, with no Undo, for %s', async (_n, queue) => {
    serve(CARD, queue)
    render(<InboxPage />)
    expect(await screen.findByText('Posting review…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('applying')).toBeTruthy()
  })

  it('drops Undo when the countdown reaches zero', async () => {
    serve(CARD, [entry({ readyAt: NOW + 2_000 })])
    render(<InboxPage />)
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('Posting review…')).toBeTruthy()
  })

  it('keeps Undo for a held row', async () => {
    serve(CARD, [entry({ state: 'held', holdReason: 'typing', holdDetail: 'someone is typing' })])
    render(<InboxPage />)
    const line = await screen.findByRole('status')
    expect(line.textContent).toContain('someone is typing')
    expect(within(line).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('is a status region, and takes focus to Undo when a click has just answered the card', async () => {
    let answered = false
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        const item = answered ? CARD : { ...CARD, status: 'open', answer: null }
        return {
          items: [item],
          people: [{ id: 'n', name: 'N' }],
          groups: [],
          automations: [],
          runLines: {}
        }
      }
      if (method === 'pilot.queue.list') {
        return { entries: answered ? [entry({})] : [] }
      }
      if (method === 'pilot.inbox.answer') {
        answered = true
      }
      return { imported: 0, skipped: [] }
    })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Post review' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    expect(undo.closest('[role="status"]')).not.toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(undo))
  })

  it('does not take focus for a card that was already answered when the page loaded', async () => {
    serve(CARD, [entry({})])
    render(<InboxPage />)
    const undo = await screen.findByRole('button', { name: 'Undo' })
    expect(document.activeElement).not.toBe(undo)
    expect(undo.closest('[role="status"]')).not.toBeNull()
  })

  it('says Skipped, with Undo while it can still be taken back', async () => {
    serve({ ...CARD, answer: { ...CARD.answer!, option: 1, text: 'skip' } }, [
      entry({ answer: 'skip' })
    ])
    render(<InboxPage />)
    expect(await screen.findByText('Skipped')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
})

describe('one click sends what the old radio + Save sent', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })
  const open = (over: Record<string, unknown>) =>
    ({ ...CARD, status: 'open', answer: null, ...over }) as unknown as InboxItemRow
  it.each([
    ['push Approve', { action: 'push' }, 'Push to origin', { text: 'approve', option: 0 }],
    ['push Skip', { action: 'push' }, 'Skip', { text: 'skip', option: 1 }],
    [
      'question option',
      { action: null, type: 'question', options: [{ label: 'Install', meaning: 'x' }] },
      'Install',
      { text: 'Install', option: 0 }
    ],
    [
      'drafted fix',
      { action: null, type: 'bug', details: { drafted: true } },
      'Apply fix',
      { text: 'approve', option: 0 }
    ]
  ])('%s', async (_n, over, button, sent) => {
    serve(open(over), [])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: button }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({
          id: 'in_a',
          digest: 'dig1',
          ...sent
        })
      )
    )
  })

  it('a default the agents took is Keep or Revert in one click, the same way', async () => {
    serve(
      open({
        action: null,
        type: 'default',
        options: [
          { label: 'Keep', meaning: '' },
          { label: 'Revert', meaning: '' }
        ]
      }),
      []
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByText(/Defaults the agents took/))
    fireEvent.click(await screen.findByRole('button', { name: 'Revert' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({
          id: 'in_a',
          digest: 'dig1',
          text: 'Revert',
          option: 1
        })
      )
    )
  })

  it('left_for_you with a draft: Apply fix sends approve at option 0', async () => {
    serve(open({ action: null, type: 'left_for_you', details: { drafted: true } }), [])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Apply fix' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_a', digest: 'dig1', text: 'approve', option: 0 })
      )
    )
  })

  it('a question’s drafted option is picked like any option: its label and index', async () => {
    serve(
      open({
        action: null,
        type: 'question',
        options: [
          { label: 'Install', meaning: 'slow' },
          { label: 'Bake it', meaning: 'fast' }
        ],
        details: { drafted: true, draftedOption: 'Bake it' }
      }),
      []
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Bake it' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_a', digest: 'dig1', text: 'Bake it', option: 1 })
      )
    )
  })

  it('a review card with one part switched off sends "approve except: 1" with no option', async () => {
    serve(
      open({
        action: 'post_review',
        parts: { '1': 'one', '2': 'two' },
        switchWords: ['Post', 'Skip']
      }),
      []
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByLabelText('Post 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({
          id: 'in_a',
          digest: 'dig1',
          text: 'approve except: 1'
        })
      )
    )
    const sent = pilotRpc.mock.calls.find((c) => c[0] === 'pilot.inbox.answer')![1]
    expect(sent).not.toHaveProperty('option')
  })
})
