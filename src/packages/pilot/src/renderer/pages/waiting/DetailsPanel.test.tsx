// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { DetailsRef } from '../../../shared/details'
import { TooltipProvider } from '@/components/ui/tooltip'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { resetSectionFilter } from '../../details/section-filter'
import { InboxPage } from './InboxPage'

const REF: DetailsRef = {
  path: '/b.json',
  sha256: 'x',
  inlined: {},
  blocks: 1,
  drafted: true,
  draftedBase: null,
  summary: ['drafted fix', 'diff +1 −1', 'before / after']
}
function card(id: string, over: Partial<InboxItemRow> = {}): InboxItemRow {
  return {
    id,
    automationId: 'a',
    runId: 'r',
    stepIdx: 0,
    itemKey: null,
    worktreePath: '/w/web-1',
    person: 'nish',
    type: 'left_for_you',
    title: `Card ${id}`,
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    digest: `d${id}`,
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
const BUNDLE = {
  ref: REF,
  bundle: {
    version: 1,
    item: 'x',
    blocks: [{ type: 'facts', title: 'What Approve does', rows: [['Then', 'one']] }]
  },
  texts: {}
}

function serve(items: InboxItemRow[]) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return {
        items,
        people: [{ id: 'nish', name: 'Nish' }],
        groups: [],
        automations: [],
        runLines: {}
      }
    }
    if (method === 'pilot.inbox.details') {
      return { snapshot: BUNDLE }
    }
    if (method === 'pilot.queue.list') {
      return { entries: [] }
    }
    return { imported: 0, answers: 0, runs: 0, skipped: [], applied: false }
  })
}

describe('the Details panel', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('is a bordered panel with a bar: arrow, bold Details, summary chips, Show or Hide', async () => {
    serve([card('p1', { details: REF })])
    render(<InboxPage />, { wrapper: TooltipProvider })
    const bar = await screen.findByRole('button', { name: /^Details/ })
    expect(bar.getAttribute('aria-expanded')).toBe('false')
    expect(bar.querySelector('svg')).not.toBeNull()
    expect(within(bar).getByText('Details').className).toContain('font-bold')
    expect(
      ['drafted fix', 'diff +1 −1', 'before / after'].map((c) => within(bar).getByText(c))
    ).toHaveLength(3)
    expect(within(bar).getByText('Show')).toBeTruthy()
    const panel = bar.closest('[data-slot="collapsible"]')!
    expect(panel.className).toContain('border')
    fireEvent.click(bar)
    expect(await screen.findByRole('heading', { name: 'What Approve does' })).toBeTruthy()
    expect(within(bar).getByText('Hide')).toBeTruthy()
    expect(bar.getAttribute('aria-expanded')).toBe('true')
  })

  it('uses the same panel for markdown-only Details, with no chips; and none without Details', async () => {
    serve([card('m1', { detailsMd: '## Why\nbecause' }), card('n1')])
    render(<InboxPage />, { wrapper: TooltipProvider })
    const bar = await screen.findByRole('button', { name: /^Details/ })
    expect(bar.querySelectorAll('span.font-mono')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /^Details/ })).toHaveLength(1)
  })

  it('Expand all opens every card’s Details and Collapse all closes them; single toggles keep working', async () => {
    serve([
      card('e1', { details: REF }),
      card('e2', { details: REF }),
      card('e3', { detailsMd: 'x' }),
      card('e4')
    ])
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findAllByRole('button', { name: /^Details/ })
    const bars = () => screen.getAllByRole('button', { name: /^Details/ })
    fireEvent.click(screen.getByRole('button', { name: 'Expand all details' }))
    expect(bars().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true'])
    // One card closed by hand: the button offers to expand again.
    fireEvent.click(bars()[0])
    expect(bars().map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true'])
    expect(screen.getByRole('button', { name: 'Expand all details' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all details' }))
    expect(screen.getByRole('button', { name: 'Collapse all details' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all details' }))
    expect(bars().map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
  })

  it('offers no Expand all when no card has Details', async () => {
    serve([card('x1')])
    render(<InboxPage />, { wrapper: TooltipProvider })
    await screen.findByRole('heading', { name: 'Card x1' })
    expect(screen.queryByRole('button', { name: /all details/ })).toBeNull()
  })

  it('has All and None on the bar, which switch every section of the card on or off', async () => {
    window.localStorage.clear()
    resetSectionFilter()
    serve([card('s1', { details: REF })])
    render(<InboxPage />, { wrapper: TooltipProvider })
    const bar = await screen.findByRole('button', { name: /^Details/ })
    expect(screen.queryByRole('button', { name: 'None' })).toBeNull()
    fireEvent.click(bar)
    await screen.findByRole('heading', { name: 'What Approve does' })
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.getByText('No sections switched on. Pick one above.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'What Approve does' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('heading', { name: 'What Approve does' })).toBeTruthy()
  })
})
