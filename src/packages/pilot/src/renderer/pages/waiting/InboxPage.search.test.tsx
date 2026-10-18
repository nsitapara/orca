// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload } from '../../../shared/inbox-types'
import type * as InboxCardModule from './InboxCard'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
// Each card render and each commit, in order.
const log = vi.hoisted((): string[] => [])
vi.mock('./InboxCard', async (importOriginal) => {
  const real = await importOriginal<typeof InboxCardModule>()
  return {
    ...real,
    InboxCard: (props: Parameters<typeof real.InboxCard>[0]) => {
      log.push(`card ${props.item.id}`)
      return <real.InboxCard {...props} />
    }
  }
})

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

const CARDS = ['First', 'Second', 'Third'].map((title, i) =>
  inboxRow({ id: `c${i}`, title, worktreePath: '/w/web-1' })
)
const listOf = (items: InboxListRow[]): InboxListPayload => ({
  items,
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
})

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  resetInboxViewPrefs()
  log.length = 0
})

describe('searching the cards', () => {
  it('shows the keystroke without re-rendering a card; the cards follow it once filtered', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return listOf(CARDS)
      }
      return method === 'pilot.queue.list' ? { entries: [] } : []
    })
    render(
      <Profiler id="inbox" onRender={() => log.push('commit')}>
        <InboxPage />
      </Profiler>
    )
    await screen.findByRole('heading', { name: 'Second' })
    log.length = 0
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cards' }), {
      target: { value: 'sec' }
    })
    // The first commit is the search box's own; only the filtered render touches the cards.
    expect(log.slice(0, log.indexOf('commit'))).toEqual([])
    expect(log).toContain('card c1')
    expect(screen.queryAllByRole('article').map((a) => a.querySelector('h3')?.textContent)).toEqual(
      ['Second']
    )
  })
})
