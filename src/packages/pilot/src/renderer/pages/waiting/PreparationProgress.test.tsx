// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import {
  preparationRef,
  queuedPreparation,
  type InboxPreparation
} from '../../../shared/preparation'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { MINI } from '../../hosts/__fixtures__/hosts'
import { PilotHostProvider } from '../../hosts/PilotHostContext'
import { PreparationProgress } from './PreparationProgress'

const REQUEST = JSON.stringify({ ask: 'Push !1561?', recovery: 'Rerun the pinned checks' })
const full = (state: InboxPreparation['state']): InboxPreparation => ({
  ...queuedPreparation({ key: 'k', context: REQUEST, requirements: ['context', 'diff'] }, 1),
  state,
  error: state === 'blocked' ? 'After shot missing' : null
})
const row = (state: InboxPreparation['state']) =>
  ({ id: 'c1', preparation: preparationRef(full(state)) }) as unknown as InboxListRow

describe('PreparationProgress', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('says a never-prepared push needs evidence and offers Prepare evidence', async () => {
    const onPrepareEvidence = vi.fn(async () => null)
    const item = { id: 'c1', needsEvidence: true } as unknown as InboxListRow
    render(
      <PreparationProgress
        item={item}
        onRetry={async () => null}
        onPrepareEvidence={onPrepareEvidence}
      />
    )
    expect(screen.getByText(/Needs evidence/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare evidence' }))
    await waitFor(() => expect(onPrepareEvidence).toHaveBeenCalledTimes(1))
  })

  it('offers Retry on a blocked card, and only there', async () => {
    const onRetry = vi.fn(async () => null)
    render(
      <PreparationProgress
        item={row('blocked')}
        onRetry={onRetry}
        onPrepareEvidence={async () => null}
      />
    )
    expect(screen.getByText('After shot missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))
    cleanup()
    render(
      <PreparationProgress
        item={row('generating')}
        onRetry={onRetry}
        onPrepareEvidence={async () => null}
      />
    )
    expect(screen.queryByRole('button', { name: 'Retry preparation' })).toBeNull()
  })

  it('shows why a Retry was refused', async () => {
    render(
      <PreparationProgress
        item={row('blocked')}
        onRetry={async () => 'Only a blocked preparation can be retried'}
        onPrepareEvidence={async () => null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
    expect(await screen.findByText('Only a blocked preparation can be retried')).toBeTruthy()
  })

  it('loads the full request only when asked (the list carries a light ref)', async () => {
    pilotRpc.mockResolvedValue({ id: 'c1', preparation: full('queued') })
    render(
      <PreparationProgress
        item={row('queued')}
        onRetry={async () => null}
        onPrepareEvidence={async () => null}
      />
    )
    expect(pilotRpc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show the request' }))
    expect(await screen.findByText(/Rerun the pinned checks/)).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.get', { id: 'c1' })
  })

  it("loads a remote card's full request from its machine", async () => {
    pilotRpc.mockResolvedValue({ id: 'c1', preparation: full('queued') })
    render(
      <PilotHostProvider host={MINI}>
        <PreparationProgress
          item={row('queued')}
          onRetry={async () => null}
          onPrepareEvidence={async () => null}
        />
      </PilotHostProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show the request' }))
    expect(await screen.findByText(/Rerun the pinned checks/)).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.get', { id: 'c1' }, { target: MINI.target })
  })
})
