// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { AnswerState, QueueEntry } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

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
  title: 'Mark !1579 ready?',
  context: '',
  options: [
    { label: 'Approve', meaning: 'mark it ready' },
    { label: 'Skip', meaning: 'leave it' }
  ],
  suggested: null,
  detailsMd: null,
  details: null,
  action: 'mark_ready',
  actionArgs: { argv: ['1579', '430f7e68'] },
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
    fires: 'Run mark_ready; no agent',
    updatedAt: NOW,
    ...over
  }) as QueueEntry

const state = (over: Partial<AnswerState>): AnswerState => ({
  locked: false,
  sentBeforePilot: false,
  state: 'not_ready',
  readyAt: NOW + 179_000,
  reason: null,
  ...over
})

function serve(item: InboxItemRow, queue: QueueEntry[], answerState?: AnswerState) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return {
        items: [item],
        people: [{ id: 'n', name: 'N' }],
        groups: [],
        automations: [],
        runLines: {},
        answerStates: answerState ? { [item.id]: answerState } : {}
      }
    }
    if (method === 'pilot.queue.list') {
      return { entries: queue }
    }
    return { imported: 0, skipped: [] }
  })
}

// Tabs persist in a module cache and storage; each test starts on Needs you.
afterEach(() => {
  window.localStorage.clear()
  resetInboxViewPrefs()
})
const tabs = () => within(screen.getByRole('toolbar', { name: 'Card status' }))
// A locked answer can't be undone, so its card leaves Needs you and shows under All.
const openAll = async () => fireEvent.click(await tabs().findByRole('button', { name: 'All · 1' }))

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
    serve(CARD, [entry({})], state({}))
    render(<InboxPage />)
    expect(await screen.findByText('Mark ready in 2:59')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getByText('answered')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(screen.getByText('Mark ready in 2:56')).toBeTruthy()
  })

  it('Undo clears the answer through the same save, with no words and the card’s digest', async () => {
    serve(CARD, [entry({})], state({}))
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_a', text: '', digest: 'dig1' })
      )
    )
  })

  it('says what is being done, with no Undo and the applying pill, only when the server says it is locked', async () => {
    serve(CARD, [], state({ locked: true, state: 'ready', readyAt: NOW - 1000 }))
    render(<InboxPage />)
    await openAll()
    expect(await screen.findByText('Marking ready…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('applying')).toBeTruthy()
  })

  it.each([
    ['no queue row', state({ state: null, readyAt: null })],
    ['a row past its settle time that nothing has picked up', state({ readyAt: NOW - 1 })]
  ])('says Pilot has not carried it out yet, with Undo, for %s', async (_n, st) => {
    serve(CARD, [], st)
    render(<InboxPage />)
    const line = await screen.findByRole('status')
    expect(line.textContent).toContain('Waiting for Pilot to carry it out')
    expect(within(line).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.queryByText('applying')).toBeNull()
  })

  it('moves to waiting for Pilot, not to applying, when the countdown reaches zero unlocked', async () => {
    serve(CARD, [], state({ readyAt: NOW + 2_000 }))
    render(<InboxPage />)
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(screen.getByRole('status').textContent).toContain('Waiting for Pilot to carry it out')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.queryByText('Marking ready…')).toBeNull()
  })

  it('shows a failed row’s reason with Change answer, which clears the answer', async () => {
    serve(CARD, [], state({ state: 'failed', reason: 'no main checkout', readyAt: NOW - 5 }))
    render(<InboxPage />)
    const line = await screen.findByRole('status')
    expect(line.textContent).toContain('Didn’t go through: no main checkout')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Change answer' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_a', text: '', digest: 'dig1' })
      )
    )
  })

  it('says an answer sent before Pilot was sent, with no Undo and no waiting; Change answer only because the server allows it', async () => {
    serve(CARD, [], state({ state: 'dispatched', sentBeforePilot: true, readyAt: NOW - 5 }))
    render(<InboxPage />)
    const line = await screen.findByRole('status')
    expect(line.textContent).toContain('Answer sent before Pilot')
    expect(line.textContent).not.toContain('Waiting for Pilot')
    expect(within(line).queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Change answer' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_a', text: '', digest: 'dig1' })
      )
    )
  })

  it('shows no Change answer for a sent-before-Pilot answer the server has locked', async () => {
    serve(CARD, [], state({ state: 'dispatched', sentBeforePilot: true, locked: true }))
    render(<InboxPage />)
    await openAll()
    const line = await screen.findByRole('status')
    expect(within(line).queryByRole('button')).toBeNull()
  })

  it('keeps Undo for a held row, with its reason', async () => {
    serve(CARD, [], state({ state: 'held', reason: 'someone is typing', readyAt: NOW - 5 }))
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
          runLines: {},
          answerStates: answered ? { in_a: state({}) } : {}
        }
      }
      if (method === 'pilot.queue.list') {
        return { entries: [] }
      }
      if (method === 'pilot.inbox.answer') {
        answered = true
      }
      return { imported: 0, skipped: [] }
    })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    expect(undo.closest('[role="status"]')).not.toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(undo))
  })

  it('does not take focus for a card that was already answered when the page loaded', async () => {
    serve(CARD, [], state({}))
    render(<InboxPage />)
    const undo = await screen.findByRole('button', { name: 'Undo' })
    expect(document.activeElement).not.toBe(undo)
    expect(undo.closest('[role="status"]')).not.toBeNull()
  })

  it('says Skipped, with Undo while it can still be taken back', async () => {
    serve({ ...CARD, answer: { ...CARD.answer!, option: 1, text: 'skip' } }, [], state({}))
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
    fireEvent.click(tabs().getByRole('button', { name: /^Done for you/ }))
    fireEvent.click(await screen.findByText(/Defaults without a run/))
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
})
