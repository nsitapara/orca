// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityPayload } from '../../../shared/api-types-capacity'
import { capacity } from './__fixtures__/capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activateRunTab = vi.fn()
vi.mock('../../activity-tabs/activate-run-tab', () => ({
  activateRunTab: (...args: unknown[]) => activateRunTab(...args)
}))

import { RunningPage } from './RunningPage'

// The page's poll answers `current`.
function serve(current: CapacityPayload): void {
  pilotRpc.mockImplementation(async () => current)
}

async function shown(): Promise<void> {
  render(<RunningPage />)
  await act(async () => {})
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
})

describe("A running run's Stop and Show tab on Running", () => {
  it("stops a running run only after a yes, and says why when Pilot couldn't", async () => {
    const why = "Couldn't close terminal t1: its process is live"
    serve(capacity())
    const served = pilotRpc.getMockImplementation()
    pilotRpc.mockImplementation(async (method: string, params?: unknown) =>
      method === 'pilot.runs.stop' ? { stopped: false, reason: why } : served?.(method, params)
    )
    const stops = () => pilotRpc.mock.calls.filter(([method]) => method === 'pilot.runs.stop')
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    const dialog = within(screen.getByRole('dialog', { name: 'Stop this run?' }))
    const asks = "Its agent's tab closes. You can pick it up again from Recently finished."
    expect(dialog.getByText(asks)).toBeTruthy()
    await click('Cancel')
    expect([screen.queryByRole('dialog'), stops()]).toEqual([null, []])
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    await click('Stop run')
    expect(stops()).toEqual([['pilot.runs.stop', { runId: 'r1' }]])
    expect(await running.findByText(why)).toBeTruthy()
  })

  // counted is false for a job with no agent step, whose shell steps Stop can't end.
  it.each([
    ['a job with an agent step', true, 1],
    ['a shell-only job', false, 0]
  ])('offers Stop on the running run of %s', async (_name, counted, stops) => {
    serve(capacity({ running: [{ ...capacity().running[0], counted }] }))
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.queryAllByRole('button', { name: 'Stop' })).toHaveLength(stops)
  })

  it("shows the run's tab only when the run has one, and says when it is closed", async () => {
    const tab = { worktreePath: '/wt/web-1', tabId: 'tab-1' }
    serve(capacity({ running: [{ ...capacity().running[0], tab }] }))
    await shown()
    activateRunTab.mockReturnValue(false)
    await click('Show tab')
    expect(activateRunTab).toHaveBeenCalledWith(tab)
    expect(screen.getByText('Its tab is closed')).toBeTruthy()
  })
})
