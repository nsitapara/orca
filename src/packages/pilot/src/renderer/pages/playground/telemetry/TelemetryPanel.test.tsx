// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALLS, NEW_USAGE, PAYLOAD, TODAY_PAYLOAD } from '../../../../shared/__fixtures__/telemetry'

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

import { resetSourceIndex } from '../../../run-views/SourceLink'
import { TelemetryPanel } from './TelemetryPanel'
import { TELEMETRY_REFRESH_MS } from './use-telemetry'

// pilotcli's source index, with one command's code.
const INDEX = {
  skillsDir: '/skills',
  pilotcli: { root: '/pilotcli', commands: { 'gitlab check-mr': { file: 'gitlab.go', line: 12 } } }
}

// The params of each telemetry read, in order.
function reads(): unknown[] {
  return pilotRpc.mock.calls.filter(([m]) => m === 'pilot.telemetry.get').map(([, p]) => p)
}

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
  resetSourceIndex()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'hidden')
  Reflect.deleteProperty(document, 'hasFocus')
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
    expect(tiles.getByText('calls in 7 days').previousSibling?.textContent).toBe('7')
    expect(tiles.getByText('invalid (bad flags or values)').previousSibling?.textContent).toBe('3')
    expect(screen.getByRole('img', { name: /Calls per day/ })).toBeTruthy()
    expect(screen.getByText(/Data since Oct 12 · kept 90 days/)).toBeTruthy()
    expect(firstCells('Commands')).toEqual([
      'gitlab check-mr',
      'git get-branch',
      '(no command)',
      'worktree checkremoved'
    ])
    expect(screen.getByText(/Never called in 7 days/).parentElement?.textContent).toContain(
      'gitlab update-mr'
    )
    expect(firstCells('By automation')).toEqual(['▸ 05 · Fix failed CI on my MRs'])
    const failures = within(screen.getByRole('table', { name: 'Recent failed and invalid calls' }))
    expect(failures.getByText('HTTP 502')).toBeTruthy()
    expect(failures.getByText('Pilot (claude) · 05 context')).toBeTruthy()
    expect(failures.getAllByText('invalid flag')).toHaveLength(2)
    expect(failures.getByText('(no command)')).toBeTruthy()
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
    ],
    ['the read still running', new Promise(() => {}), "Reading pilotcli's telemetry…"],
    [
      'more failed calls than shown',
      { ...PAYLOAD, failures: { calls: CALLS, more: true } },
      'Showing the newest 50.'
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
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    expect(reads()).toEqual([
      { since: '7d', includeDev: false },
      { since: '30d', includeDev: false },
      { since: '30d', includeDev: true },
      { since: '30d', includeDev: true, command: 'gitlab check-mr' },
      { since: '30d', includeDev: true }
    ])
  })

  it('reads every 2 minutes while the window shows and has focus, again on show or focus, and stops when inactive or gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let hidden = false
    let focused = true
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused })
    pilotRpc.mockImplementation(async () => PAYLOAD)
    const view = render(<TelemetryPanel />)
    await act(async () => {})
    expect(reads()).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(TELEMETRY_REFRESH_MS)
    })
    expect(reads()).toHaveLength(2)
    hidden = true
    await act(async () => {
      vi.advanceTimersByTime(2 * TELEMETRY_REFRESH_MS)
    })
    expect(reads()).toHaveLength(2)
    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(reads()).toHaveLength(3)
    // Shown on another screen without focus: no timed read until the window has focus again.
    focused = false
    await act(async () => {
      vi.advanceTimersByTime(2 * TELEMETRY_REFRESH_MS)
    })
    expect(reads()).toHaveLength(3)
    focused = true
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(reads()).toHaveLength(4)
    view.rerender(<TelemetryPanel active={false} />)
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(reads()).toHaveLength(4)
    view.rerender(<TelemetryPanel />)
    await act(async () => {})
    expect(reads()).toHaveLength(5)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the last data when a refresh fails, and says why beside it', async () => {
    await shown(PAYLOAD)
    pilotRpc.mockImplementation(async () => {
      throw new Error('pilotcli self get-telemetry timed out after 10s')
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    expect(screen.getByText(/timed out after 10s/)).toBeTruthy()
    expect(firstCells('Commands')).toEqual([
      'gitlab check-mr',
      'git get-branch',
      '(no command)',
      'worktree checkremoved'
    ])
    expect(screen.getByText(/This Mac · updated \d\d:\d\d/)).toBeTruthy()
  })

  it('labels each day of a short window under its bar, with its calls above it', async () => {
    await shown(PAYLOAD)
    const days = within(screen.getByRole('list', { name: 'Calls each day' }))
    expect(days.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Oct 11: -',
      'Oct 12: -',
      'Oct 13: -',
      'Oct 14: -',
      'Oct 15: 2',
      'Oct 16: 3',
      'Oct 17: 2'
    ])
  })

  it('shows no legend without a chart', async () => {
    await shown(TODAY_PAYLOAD)
    expect(screen.queryByText('ok or skip')).toBeNull()
  })

  it('opens an automation row to the commands each step called', async () => {
    await shown(PAYLOAD)
    const caret = screen.getByRole('button', { name: 'Steps of 05 · Fix failed CI on my MRs' })
    expect(caret.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(caret)
    expect(caret.getAttribute('aria-expanded')).toBe('true')
    const steps = document.getElementById(caret.getAttribute('aria-controls') ?? '')
    expect(steps?.textContent).toBe('contextgitlab check-mr ×3')
    expect(
      within(screen.getByRole('table', { name: 'By automation' })).getByText('gitlab check-mr ×3')
    ).toBeTruthy()
  })

  it.each([
    ['no command', '', '(no command)'],
    ["a name Pilot can't filter by", 'inbox', 'inbox']
  ])('names a row with %s as plain text, not a button to pick', async (_name, command, text) => {
    const row = { ...NEW_USAGE.commands[1], command, removed: true }
    await shown({ ...PAYLOAD, usage: { ...NEW_USAGE, commands: [row] } })
    const commands = within(screen.getByRole('table', { name: 'Commands' }))
    expect(commands.getByText(text)).toBeTruthy()
    expect(commands.queryAllByRole('button')).toHaveLength(0)
  })

  it("names a job that isn't recorded without a link to Activity", async () => {
    const unrecorded = {
      automation: '',
      name: 'Pilot run (job not recorded)',
      runs: 4,
      calls: 8,
      steps: []
    }
    await shown({ ...PAYLOAD, usage: { ...NEW_USAGE, jobs: [unrecorded] } })
    expect(screen.getByText('Pilot run (job not recorded)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pilot run (job not recorded)' })).toBeNull()
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

  it.each([
    [
      'is no longer there: plain text',
      new Error('No run "fix-failed-ci-202610171420-t1-1"'),
      false
    ],
    [
      "can't be read just now: the link stays",
      new Error('pilot.runs.get timed out after 15s'),
      true
    ]
  ])('when the run %s', async (_name, error, linked) => {
    await shown(PAYLOAD)
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.runs.get') {
        throw error
      }
      return PAYLOAD
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    })
    expect(openRun).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Open run' }) !== null).toBe(linked)
    expect(screen.queryByText('fix-failed-ci-202610171420-t1-1') !== null).toBe(!linked)
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

  it.each([
    ['the desktop', false, 1],
    ['the browser version', true, 0]
  ])('in %s, a picked command has Try it and Source: %s', async (_name, web, offered) => {
    if (web) {
      vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    }
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.sourceIndex.get' ? INDEX : PAYLOAD
    )
    render(<TelemetryPanel onTryIt={vi.fn()} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    expect(screen.queryAllByRole('button', { name: 'Try it' })).toHaveLength(offered)
    expect(screen.queryAllByRole('button', { name: 'Source' })).toHaveLength(offered)
  })
})
