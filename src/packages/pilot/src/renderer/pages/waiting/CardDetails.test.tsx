// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({
  pilotRpc: (...args: unknown[]) => pilotRpc(...args)
}))

import { CardDetails } from './CardDetails'

const snapshot = {
  ref: {
    path: '/b.json',
    sha256: 'x',
    inlined: {},
    blocks: 1,
    drafted: false,
    draftedBase: null
  },
  bundle: {
    version: 1,
    item: 'R',
    blocks: [
      {
        type: 'facts',
        title: 'What Approve does',
        rows: [['Then', 'one commit']]
      }
    ]
  },
  texts: {}
}
const item = (id: string): InboxItemRow =>
  ({
    id,
    digest: 'd'.repeat(64),
    details: snapshot.ref,
    detailsMd: null
  }) as unknown as InboxItemRow

describe('CardDetails', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('offers Retry when loading the Details fails, and re-fetches on click', async () => {
    pilotRpc.mockRejectedValueOnce(new Error('The card changed; review it again'))
    pilotRpc.mockResolvedValueOnce({ snapshot })
    render(<CardDetails item={item('retry-1')} parts={null} />)
    fireEvent.click(screen.getByText('Details'))
    expect(await screen.findByText(/The card changed; review it again/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('What Approve does')).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
