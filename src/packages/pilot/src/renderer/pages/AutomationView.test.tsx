// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickOutcome } from '../../shared/api-types'
import { detail, failedRunTick } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AutomationView } from './AutomationView'

function serve(outcome: TickOutcome = { status: 'busy' }): void {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.automations.get') {
      return detail
    }
    if (method === 'pilot.automations.activity') {
      return [failedRunTick]
    }
    return outcome
  })
}

const calls = (method: string): unknown[][] => pilotRpc.mock.calls.filter((c) => c[0] === method)

describe('AutomationView', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows a failed launch on the run, and the Overview tab shows the definition', async () => {
    serve()
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    expect(await screen.findByText(/Couldn't start: no such repo/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByText(/schedule: manual/)).toBeTruthy()
  })

  it("shows the Overview's steps", async () => {
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.automations.get' ? detail : []
    )
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Overview' }))
    expect(await screen.findByText('1. fix')).toBeTruthy()
  })

  it('shows the empty state when there are no ticks', async () => {
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.automations.get' ? detail : []
    )
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    expect(await screen.findByText('No ticks yet.')).toBeTruthy()
  })

  it('Run now needs a Confirm before it calls tickNow, with the long timeout', async () => {
    serve({ tickId: 12, status: 'ok', error: null, decisions: [] })
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    expect(screen.getByText(/Start agents for items that pass the checks\?/)).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Tick 12 · ok')).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toEqual([
      ['pilot.automations.tickNow', { id: 'fix-ci' }, { timeoutMs: 180_000 }]
    ])
  })

  it('Cancel backs out without calling tickNow', async () => {
    serve()
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toHaveLength(0)
  })

  it('Dry run needs no confirm, disables both buttons while running, then reports', async () => {
    let finish: (v: TickOutcome) => void = () => {}
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.automations.get') {
        return Promise.resolve(detail)
      }
      if (method === 'pilot.automations.activity') {
        return Promise.resolve([])
      }
      return new Promise<TickOutcome>((resolve) => {
        finish = resolve
      })
    })
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText('Running…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Dry run' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(calls('pilot.automations.dryRun')[0]).toEqual([
      'pilot.automations.dryRun',
      { id: 'fix-ci' },
      { timeoutMs: 180_000 }
    ])
    const before = calls('pilot.automations.activity').length
    finish({ tickId: 5, status: 'failed', error: 'repo not found', decisions: [] })
    expect(await screen.findByText('Tick 5 · failed: repo not found')).toBeTruthy()
    await waitFor(() => expect(calls('pilot.automations.activity').length).toBeGreaterThan(before))
  })

  it.each([
    [{ status: 'busy' as const }, 'Tick already running'],
    [{ status: 'unknown' as const }, 'No automation fix-ci']
  ])('reports %j', async (outcome, text) => {
    serve(outcome)
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('shows the error when the call itself fails', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.automations.get') {
        return detail
      }
      if (method === 'pilot.automations.activity') {
        return []
      }
      throw new Error("Pilot isn't running: store won't open")
    })
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText("Pilot isn't running: store won't open")).toBeTruthy()
  })

  it('fires tickNow once for a double Confirm', async () => {
    serve({ tickId: 1, status: 'ok', error: null, decisions: [] })
    render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    // Both clicks land in one batch, before React re-renders the button away.
    act(() => {
      confirm.click()
      confirm.click()
    })
    await screen.findByText('Tick 1 · ok')
    expect(calls('pilot.automations.tickNow')).toHaveLength(1)
  })

  it('does not refresh after unmount when a call finishes late', async () => {
    let finish: (v: TickOutcome) => void = () => {}
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.automations.get') {
        return Promise.resolve(detail)
      }
      if (method === 'pilot.automations.activity') {
        return Promise.resolve([])
      }
      return new Promise<TickOutcome>((resolve) => {
        finish = resolve
      })
    })
    const { unmount } = render(<AutomationView id="fix-ci" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    unmount()
    const before = calls('pilot.automations.activity').length
    finish({ status: 'busy' })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls('pilot.automations.activity')).toHaveLength(before)
  })
})
