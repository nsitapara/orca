// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'
import { INBOX_CSS } from './inbox-style'
import { queuedPreparation } from '../../../shared/preparation'
import { statusOf, statusPillClass } from './chips'

describe('chip colours (the console’s: answers.html)', () => {
  it.each([
    ['waiting', 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'],
    ['answered', 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'],
    ['applying', 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)] animate-pulse'],
    ['failed', 'bg-[var(--ib-bad-soft)] text-[var(--ib-bad)]'],
    ['done', 'bg-[var(--ib-ok-soft)] text-[var(--ib-ok)]'],
    ['unsaved', 'bg-[var(--ib-accent)] text-[var(--ib-accent-fg)]']
  ] as const)('a %s status pill', (status, colours) => {
    expect(statusPillClass(status)).toContain(colours)
  })

  it('reads a card’s status: waiting, answered, applying only when the server says locked, failed, done, unsaved over all', () => {
    const at = (status: InboxItemRow['status']) => ({ status })
    const st = (locked: boolean, state: AnswerState['state']): AnswerState => ({
      locked,
      sentBeforePilot: false,
      state,
      readyAt: 100,
      reason: null
    })
    expect(statusOf(at('open'), null, false)).toBe('waiting')
    expect(statusOf(at('answered'), st(false, 'not_ready'), false)).toBe('answered')
    expect(statusOf(at('answered'), st(false, 'held'), false)).toBe('answered')
    expect(statusOf(at('answered'), st(false, null), false)).toBe('answered')
    expect(statusOf(at('answered'), st(false, 'failed'), false)).toBe('failed')
    expect(statusOf(at('answered'), st(true, 'ready'), false)).toBe('applying')
    expect(statusOf(at('done'), null, false)).toBe('done')
    expect(statusOf(at('answered'), null, true)).toBe('unsaved')
  })

  it('defines the console’s tokens under .pilot-inbox, light and dark', () => {
    const [light, dark] = INBOX_CSS.split('.dark .pilot-inbox')
    expect(light).toContain('.pilot-inbox{')
    for (const v of [
      '#1e5ad6',
      '#d4ddf1',
      '#2b7a1c',
      '#d6e2d9',
      '#8a5a06',
      '#e2ddd6',
      '#b80d33',
      '#e8d3dc'
    ]) {
      expect(light).toContain(v)
    }
    for (const v of [
      '#89b4fa',
      '#303851',
      '#a6e3a1',
      '#353f42',
      '#f9e2af',
      '#433f44',
      '#f38ba8',
      '#423143'
    ]) {
      expect(dark).toContain(v)
    }
  })
})

function card(over: Partial<InboxItemRow>): InboxItemRow {
  return {
    id: 'c1',
    automationId: 'a',
    runId: 'r',
    stepIdx: 0,
    itemKey: null,
    worktreePath: '/w/web-1',
    person: 'nish',
    type: 'bug',
    title: 'A bug',
    context: '',
    options: [{ label: 'Approve', meaning: '' }],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    digest: 'd',
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

describe('colours on the page', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows preparation progress separately from waiting and offers an early answer without approval', async () => {
    const preparation = queuedPreparation(
      {
        key: 'finding',
        context: 'Investigate the decision',
        requirements: ['context', 'diff', 'screens']
      },
      1
    )
    const items = [card({ preparation })]
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return {
          items,
          runLines: {},
          answerStates: {},
          people: [{ id: 'nish', name: 'Nish' }],
          groups: [],
          automations: [{ id: 'a', name: 'Review' }]
        }
      }
      return { entries: [] }
    })
    render(<InboxPage />)
    expect(await screen.findByText('1 preparing context')).toBeTruthy()
    expect(screen.getByText('0 waiting')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Answer before context is ready…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fix it' })).toBeNull()
    expect(
      screen.getByText(
        'Needed for your decision: decision context, code diff, before / after screenshots.'
      )
    ).toBeTruthy()
  })

  it('has no waiting pill and no kind chip, and highlights a question’s first option', async () => {
    const items = [
      card({ id: 'b', type: 'bug', title: 'A bug' }),
      card({
        id: 'q',
        type: 'question',
        title: 'A question',
        options: [
          { label: 'Install', meaning: 'x' },
          { label: 'Bake', meaning: '' }
        ]
      })
    ]
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return {
          items,
          people: [{ id: 'n', name: 'N' }],
          groups: [],
          automations: [],
          runLines: {}
        }
      }
      return method === 'pilot.queue.list' ? { entries: [] } : { imported: 0, skipped: [] }
    })
    const { container } = render(<InboxPage />)
    const bug = (await screen.findByRole('heading', { name: 'A bug' })).closest('article')!
    expect(bug.textContent).not.toContain('waiting')
    // No kind chip: neither the card nor its list row says "Left for you" or "Question".
    expect(container.textContent).not.toMatch(/Left for you|Question|Action\b/)
    const q = screen.getByRole('heading', { name: 'A question' }).closest('article')!
    expect(q.querySelector('[data-choice="Install"]')?.className).toContain('bg-[var(--ib-accent)]')
    expect(q.querySelector('[data-choice="Bake"]')?.className).not.toContain(
      'bg-[var(--ib-accent)]'
    )
    expect(bug.querySelector('[data-choice="Approve"]')?.className).toContain(
      'bg-[var(--ib-accent)]'
    )
    expect(container.querySelector('.pilot-inbox')).not.toBeNull()
    expect(container.querySelector('style[data-pilot-inbox]')).not.toBeNull()
  })
})
