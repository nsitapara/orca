// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { DetailsBundle, DetailsRef } from '../../../shared/details'
import type { InboxListPayload } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxPage } from './InboxPage'
import { resetInboxViewPrefs } from './inbox-view-prefs'

const listOf = (items: InboxListRow[]): InboxListPayload => ({
  items,
  people: [{ id: 'nish', name: 'Nish Sitapara' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
})

// Tabs persist in a module cache and storage; each test starts on Needs you.
afterEach(() => {
  window.localStorage.clear()
  resetInboxViewPrefs()
})

const FIXTURES = join(process.cwd(), 'src/packages/pilot/test/fixtures/details')
const REF: DetailsRef = {
  path: '/b.json',
  sha256: 'x',
  inlined: {},
  blocks: 1,
  drafted: false,
  draftedBase: null
}
function bundleOf(file: string): DetailsBundle {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
}

describe('Details on a card', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  function serveDetails(items: () => InboxListRow[], bundle: DetailsBundle = bundleOf('F2.json')) {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return listOf(items())
      }
      if (method === 'pilot.inbox.details') {
        return { id: 'x', digest: 'x', snapshot: { ref: REF, bundle, texts: {} } }
      }
      return { entries: [] }
    })
  }
  const detailCalls = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.details')

  it('loads the snapshot for the digest shown when it opens, and draws the titles', async () => {
    const withDetails = inboxRow({ id: 'in_a', title: 'A', digest: 'da1', details: REF })
    serveDetails(() => [withDetails])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    expect(await screen.findByRole('heading', { name: 'What Approve does' })).toBeTruthy()
    expect(detailCalls().map((c) => c[1])).toEqual([{ id: 'in_a', digest: 'da1' }])
  })

  it('keeps the fold-out open without a second call on a reload of the same version', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const withDetails = inboxRow({ id: 'in_b', title: 'B', digest: 'db1', details: REF })
    serveDetails(() => [{ ...withDetails }])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await screen.findByRole('heading', { name: 'What Approve does' })
    const lists = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.list').length
    const before = lists()
    await vi.advanceTimersByTimeAsync(10_500)
    expect(lists()).toBeGreaterThan(before)
    expect(screen.getByRole('heading', { name: 'What Approve does' })).toBeTruthy()
    expect(detailCalls()).toHaveLength(1)
  })

  it('stays open on a new version and asks again with the new digest', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let version = 1
    serveDetails(() => [
      inboxRow({ id: 'in_c', title: 'C', version, digest: `dc${version}`, details: REF })
    ])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await screen.findByRole('heading', { name: 'What Approve does' })
    version = 2
    await vi.advanceTimersByTimeAsync(10_500)
    await waitFor(() => expect(detailCalls()).toHaveLength(2))
    expect(detailCalls()[1][1]).toEqual({ id: 'in_c', digest: 'dc2' })
    expect(await screen.findByRole('heading', { name: 'What Approve does' })).toBeTruthy()
  })

  it('says why when the card changed before its details loaded', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.details') {
        throw new Error('The card changed; review it again')
      }
      return method === 'pilot.inbox.list'
        ? listOf([inboxRow({ id: 'in_d', title: 'D', digest: 'dd1', details: REF })])
        : { entries: [] }
    })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    expect(
      await screen.findByText(/Couldn.t load the details: The card changed; review it again/)
    ).toBeTruthy()
  })

  it('renders a markdown-only card as markdown, not raw text', async () => {
    const long = 'y'.repeat(400)
    serveDetails(() => [
      inboxRow({ id: 'in_e', title: 'E', digest: 'de1', detailsMd: `\`\`\`\n${long}\n\`\`\`` })
    ])
    const { container } = render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await waitFor(() =>
      expect(container.querySelector('.glr-body pre code')?.textContent).toBe(long)
    )
    expect(detailCalls()).toHaveLength(0)
  })

  it('shows no Details on a card with neither', async () => {
    serveDetails(() => [inboxRow({ id: 'in_f', title: 'F', digest: 'df1' })])
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F' })
    expect(screen.queryByRole('button', { name: /^Details/ })).toBeNull()
  })

  it('lets the column and the card shrink so a long line cannot widen the page', async () => {
    serveDetails(() => [inboxRow({ id: 'in_h', title: 'H', digest: 'dh1' })])
    const { container } = render(<InboxPage />)
    await screen.findByRole('heading', { name: 'H' })
    expect(container.querySelector('main')?.className).toContain('min-w-0')
    expect(container.querySelector('article')?.className).toContain('min-w-0')
    expect(container.querySelector('article')?.parentElement?.className).toContain('min-w-0')
  })
})
