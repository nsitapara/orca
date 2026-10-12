// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { InboxPage } from './InboxPage'
import { INBOX_CSS } from './inbox-style'
import { kindChipClass, statusOf, statusPillClass } from './chips'

describe('chip colours (the console’s: answers.html)', () => {
  it.each([
    ['bug', 'bg-[var(--ib-bad-soft)] text-[var(--ib-bad)]'],
    ['question', 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'],
    ['action', 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'],
    ['flagged', 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'],
    ['default', 'bg-muted text-foreground/80'],
    ['left_for_you', 'bg-muted text-foreground/80']
  ] as const)('a %s kind chip', (kind, colours) => {
    expect(kindChipClass(kind)).toContain(colours)
  })

  it.each([
    ['waiting', 'bg-[var(--ib-warn-soft)] text-[var(--ib-warn)]'],
    ['answered', 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'],
    ['applying', 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)] animate-pulse'],
    ['done', 'bg-[var(--ib-ok-soft)] text-[var(--ib-ok)]'],
    ['unsaved', 'bg-[var(--ib-accent)] text-[var(--ib-accent-fg)]']
  ] as const)('a %s status pill', (status, colours) => {
    expect(statusPillClass(status)).toContain(colours)
  })

  it('reads a card’s status: waiting, answered, applying once dispatched, done, unsaved over all', () => {
    const at = (status: InboxItemRow['status']) => ({ status })
    expect(statusOf(at('open'), null, false)).toBe('waiting')
    expect(statusOf(at('answered'), { state: 'held' }, false)).toBe('answered')
    expect(statusOf(at('answered'), { state: 'dispatched' }, false)).toBe('applying')
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
    parts: {},
    switchWords: [],
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

  it('colours a card’s chips by kind and status, and tags a question’s first option Recommended', async () => {
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
    expect(bug.querySelector('span')?.className).toContain('text-[var(--ib-bad)]')
    expect(bug.textContent).toContain('waiting')
    const waiting = [...bug.querySelectorAll('span')].find((s) => s.textContent === 'waiting')
    expect(waiting?.className).toContain('text-[var(--ib-warn)]')
    const q = screen.getByRole('heading', { name: 'A question' }).closest('article')!
    expect(q.querySelector('[role="radio"][data-value="Install"]')?.textContent).toContain(
      'Recommended'
    )
    expect(q.querySelector('[role="radio"][data-value="Bake"]')?.textContent).not.toContain(
      'Recommended'
    )
    expect(bug.querySelector('[role="radio"]')?.textContent).not.toContain('Recommended')
    expect(container.querySelector('.pilot-inbox')).not.toBeNull()
    expect(container.querySelector('style[data-pilot-inbox]')).not.toBeNull()
  })
})
