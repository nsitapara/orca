// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityPayload, ListedRun } from '../../shared/api-types'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { summary } from '../pages/fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { ActivityView } from './ActivityView'
import { resetAutomationsFeed } from './automations-feed'
import { resetEffectsFeed } from './effects-feed'
import { closeRunPanel, openRunPanel } from './run-panel-state'

const listed = (over: Partial<ListedRun>): ListedRun => ({
  ...testRun({ automationId: 'fix-ci', ...over }),
  fields: {}
})
const payload: ActivityPayload = {
  live: [
    listed({ id: 'run-a', itemLabel: '!1561 web-1', steps: [stepAt(0, 'fix', 'running')] }),
    listed({
      id: 'run-b',
      itemLabel: '!1477 web-2',
      status: 'needs_you',
      steps: [stepAt(0, 'fix', 'done')],
      inbox: [testCard({ id: 'c1', automationId: 'fix-ci', runId: 'run-b', stepIdx: 0 })]
    })
  ],
  ticks: [
    {
      id: 9,
      automationId: 'fix-ci',
      startedAt: Date.now() - 1_000,
      finishedAt: Date.now(),
      status: 'ok',
      error: null,
      counts: { started: 1 },
      items: [],
      runs: [
        testRun({
          id: 'fix-ci-3',
          automationId: 'fix-ci',
          status: 'failed',
          outcome: "Couldn't start: no such repo"
        })
      ]
    }
  ],
  loose: [],
  reach: null
}

function serve(): void {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.automations.list') {
      return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
    }
    return payload
  })
}

const activityCalls = () =>
  pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.activity.list').map((c) => c[1])

describe('ActivityView', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    resetEffectsFeed()
    closeRunPanel()
    pilotRpc.mockReset()
    localStorage.clear()
  })

  it("lists running runs, runs waiting on you and today's ticks, each run with its strip that opens it", async () => {
    serve()
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    const running = await screen.findByRole('region', { name: 'Running now' })
    expect(within(running).getByText('!1561 web-1')).toBeTruthy()
    expect(
      within(screen.getByRole('region', { name: 'Waiting on you' })).getByText('!1477 web-2')
    ).toBeTruthy()
    const today = screen.getByRole('region', { name: 'Earlier today' })
    expect(within(today).getByText("Couldn't start: no such repo")).toBeTruthy()
    fireEvent.click(
      await within(running).findByRole('button', { name: /1 fix · Running/ })
    )
    expect(openRunPanel()).toEqual({ runId: 'run-a', part: 'step:0' })
  })

  it('asks for the named automations, and only ticks with something to do until the switch is turned off', async () => {
    serve()
    render(<ActivityView automationIds={['fix-ci']} since={null} limit={30} />)
    await waitFor(() =>
      expect(activityCalls()).toEqual([
        { automationIds: ['fix-ci'], since: undefined, limit: 30, skipQuiet: true }
      ])
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Hide ticks with nothing to do' }))
    await waitFor(() => expect(activityCalls().at(-1)).toMatchObject({ skipQuiet: false }))
  })

  it("shows a run of an automation that isn't loaded, without a strip", async () => {
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.automations.list'
        ? { automations: [], errors: [], peopleError: null, missingDirs: [] }
        : {
            live: [listed({ id: 'x', automationId: 'removed', itemLabel: 'Gone job run' })],
            ticks: [],
            loose: [],
            reach: null
          }
    )
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    expect(await screen.findByText('Gone job run')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Run x' })).toBeNull()
  })

  it('shows what a run changed on its row', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.automations.list') {
        return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
      }
      if (method === 'pilot.runs.effects') {
        return {
          'run-a': [{ kind: 'pushed', target: 'web-1', url: null, count: 1, stepIdx: 0, at: 1 }]
        }
      }
      return payload
    })
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    expect(await screen.findByText('pushed web-1')).toBeTruthy()
  })

  it('says how far back the list reaches only when the page was cut', async () => {
    const cutAt = new Date(2026, 9, 14, 15, 30).getTime()
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.automations.list') {
        return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
      }
      return { ...payload, reach: cutAt }
    })
    const { unmount } = render(<ActivityView automationIds={null} since={0} limit={300} />)
    const line = await screen.findByText(/^Showing back to /)
    expect(line.textContent).toBe(
      `Showing back to ${new Date(cutAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
    )
    unmount()
    serve()
    render(<ActivityView automationIds={null} since={0} limit={300} />)
    await screen.findByRole('region', { name: 'Running now' })
    expect(screen.queryByText(/^Showing back to /)).toBeNull()
  })
})
