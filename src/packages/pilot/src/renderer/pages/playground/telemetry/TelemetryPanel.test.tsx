// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NEW_USAGE, PAYLOAD, TODAY_PAYLOAD } from '../../../../shared/__fixtures__/telemetry'

const pilotRpc = vi.fn()
vi.mock('../../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

const showActivity = vi.fn()
vi.mock('../../automations-view', () => ({
  showActivity: (...args: unknown[]) => showActivity(...args)
}))
const openRun = vi.fn()
vi.mock('../../../run-views/run-panel-state', () => ({
  openRun: (...args: unknown[]) => openRun(...args)
}))

import { TelemetryPanel } from './TelemetryPanel'

async function shown(answer: unknown): Promise<void> {
  pilotRpc.mockImplementation(async () => {
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  })
  render(<TelemetryPanel />)
  await act(async () => {})
}

function firstCells(table: string): string[] {
  const rows = within(screen.getByRole('table', { name: table }))
    .getAllByRole('row')
    .slice(1)
  return rows.map((r) => within(r).getAllByRole('cell')[0].textContent ?? '')
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  showActivity.mockReset()
  openRun.mockReset()
})

describe('TelemetryPanel', () => {
  it('shows the tiles, the chart, the commands with removed marked, never called, the jobs and the failed calls', async () => {
    await shown(PAYLOAD)
    expect(pilotRpc).toHaveBeenCalledWith(
      'pilot.telemetry.get',
      { since: '7d', includeDev: false },
      expect.anything()
    )
    const tiles = within(screen.getByRole('list', { name: 'Totals' }))
    expect(tiles.getByText('calls in 7 days').previousSibling?.textContent).toBe('6')
    expect(tiles.getByText('invalid (bad flags or values)').previousSibling?.textContent).toBe('2')
    expect(screen.getByRole('img', { name: /Calls per day/ })).toBeTruthy()
    expect(screen.getByText(/Data since Oct 12 · kept 90 days/)).toBeTruthy()
    expect(firstCells('Commands')).toEqual([
      'gitlab check-mr',
      'git get-branch',
      'worktree checkremoved'
    ])
    expect(screen.getByText(/Never called in 7 days/).parentElement?.textContent).toContain(
      'gitlab update-mr'
    )
    expect(firstCells('By automation')).toEqual(['▸ 05 · Fix failed CI on my MRs'])
    const failures = within(screen.getByRole('table', { name: 'Recent failed and invalid calls' }))
    expect(failures.getByText('HTTP 502')).toBeTruthy()
    expect(failures.getByText('Pilot (claude) · 05 context')).toBeTruthy()
    expect(failures.getByText('invalid flag')).toBeTruthy()
    expect(screen.getByText(/Free-text reasons are never stored/)).toBeTruthy()
    expect(screen.getByText(/This Mac · updated \d\d:\d\d/)).toBeTruthy()
  })

  it("with today's pilotcli, says the chart and the calls need a newer pilotcli", async () => {
    await shown(TODAY_PAYLOAD)
    expect(screen.queryByRole('img', { name: /Calls per day/ })).toBeNull()
    expect(screen.getByText(/Per-day counts need a newer pilotcli/)).toBeTruthy()
    expect(screen.getByText(/install a newer one/)).toBeTruthy()
    expect(firstCells('Commands')).toEqual(['gitlab check-mr'])
  })

  it.each([
    [
      'an error',
      new Error('pilotcli self get-telemetry timed out after 10s'),
      'pilotcli self get-telemetry timed out after 10s'
    ],
    [
      'a failed read',
      { fetchedAt: 1, error: "pilotcli isn't installed" },
      "pilotcli isn't installed"
    ],
    [
      'an answer that is not a payload',
      { process: 'main' },
      "Pilot answered in a shape this page doesn't read"
    ],
    [
      'a window with no calls',
      { ...PAYLOAD, usage: { ...NEW_USAGE, calls: 0, commands: [] } },
      'No calls in 7 days.'
    ]
  ])('shows %s', async (_name, answer, text) => {
    await shown(answer)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('asks again for another window, dev calls, or a command clicked', async () => {
    await shown(PAYLOAD)
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '30d' } })
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Dev calls'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    expect(pilotRpc.mock.calls.map(([, p]) => p)).toEqual([
      { since: '7d', includeDev: false },
      { since: '30d', includeDev: false },
      { since: '30d', includeDev: true },
      { since: '30d', includeDev: true, command: 'gitlab check-mr' }
    ])
  })

  it('opens Activity for an automation, and the run panel for a call with a run', async () => {
    await shown(PAYLOAD)
    fireEvent.click(screen.getByRole('button', { name: '05 · Fix failed CI on my MRs' }))
    expect(showActivity).toHaveBeenCalledWith(['fix-failed-ci'])
    const failures = within(screen.getByRole('table', { name: 'Recent failed and invalid calls' }))
    const links = failures.getAllByRole('button', { name: 'Open run' })
    expect(links).toHaveLength(1)
    await act(async () => {
      fireEvent.click(links[0])
    })
    expect(openRun).toHaveBeenCalledWith('fix-failed-ci-202610171420-t1-1')
  })

  it('shows the run as plain text when it is no longer there', async () => {
    await shown(PAYLOAD)
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.runs.get') {
        throw new Error('no such run')
      }
      return PAYLOAD
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    })
    expect(openRun).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Open run' })).toBeNull()
    expect(screen.getByText('fix-failed-ci-202610171420-t1-1')).toBeTruthy()
  })

  it('offers Try it for the picked command', async () => {
    const onTryIt = vi.fn()
    pilotRpc.mockImplementation(async () => PAYLOAD)
    render(<TelemetryPanel onTryIt={onTryIt} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(onTryIt).toHaveBeenCalledWith('gitlab check-mr')
  })
})
