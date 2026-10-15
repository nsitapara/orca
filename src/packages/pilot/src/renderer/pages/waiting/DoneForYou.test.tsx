// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testCard, testRun } from '../../../shared/run-views/__fixtures__/runs'
import type { DoneRun } from '../../../shared/visibility-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { resetAutomationsFeed } from '../../run-views/automations-feed'
import { resetEffectsFeed } from '../../run-views/effects-feed'
import { DoneForYou } from './DoneForYou'

const done = (id: string, over: Partial<DoneRun> = {}): DoneRun => ({
  run: { ...testRun({ id, itemLabel: `WEB-${id}`, status: 'done' }), fields: {} },
  effects: [{ kind: 'pushed', target: `web-${id}`, url: null, count: 1, stepIdx: 0, at: 1 }],
  defaults: [],
  ...over
})

describe('DoneForYou', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    resetEffectsFeed()
    pilotRpc.mockReset()
  })

  it("lists each run with what it changed and its defaults' cards, and acknowledges one or all", async () => {
    pilotRpc.mockResolvedValue([])
    const onAcknowledge = vi.fn(async () => null)
    render(
      <DoneForYou
        runs={[done('1', { defaults: [testCard({ id: 'd1', type: 'default' })] }), done('2')]}
        cardFor={(id) => <p>{`card ${id}`}</p>}
        onAcknowledge={onAcknowledge}
      />
    )
    expect(screen.getByRole('heading', { name: 'Done for you · 2' })).toBeTruthy()
    expect(screen.getByText('pushed web-1')).toBeTruthy()
    expect(screen.getByText('card d1')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[1])
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledWith(['2']))
    fireEvent.click(screen.getByRole('button', { name: 'Got all' }))
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledWith(['1', '2']))
    expect(pilotRpc.mock.calls.some((c) => c[0] === 'pilot.runs.effects')).toBe(false)
  })

  it('shows nothing when no run is waiting to be seen, and an acknowledge error when one fails', async () => {
    pilotRpc.mockResolvedValue([])
    const { container } = render(
      <DoneForYou runs={[]} cardFor={() => null} onAcknowledge={async () => null} />
    )
    expect(container.textContent).toBe('')
    cleanup()
    render(
      <DoneForYou
        runs={[done('1')]}
        cardFor={() => null}
        onAcknowledge={async () => 'Pilot is busy'}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(await screen.findByText('Pilot is busy')).toBeTruthy()
  })
})
