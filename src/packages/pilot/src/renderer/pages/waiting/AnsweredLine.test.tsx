// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('says what is being done once the answer is dispatched, with no Undo', async () => {
    serve(CARD, [entry({ state: 'dispatched', readyAt: NOW - 1000 })])
    render(<InboxPage />)
    expect(await screen.findByText('Posting review…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
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
})
