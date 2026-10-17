// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityPayload, ListedRun } from '../../shared/api-types'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import type { PilotHostEntry } from '../hosts/pilot-host'
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
    fireEvent.click(await within(running).findByRole('button', { name: /1 fix · Running/ }))
    expect(openRunPanel()).toEqual({
      runId: 'run-a',
      part: 'step:0',
      host: expect.objectContaining({ key: 'local' })
    })
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

describe('ActivityView on more than one machine', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    resetEffectsFeed()
    resetPilotHostsFeed()
    closeRunPanel()
    pilotRpc.mockReset()
    localStorage.clear()
  })

  // A machine's answers; a string is the error its Activity read fails with.
  const machine =
    (activity: ActivityPayload | string, effects = {}) =>
    (method: string) => {
      if (method === 'pilot.automations.list') {
        return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
      }
      if (method === 'pilot.runs.effects') {
        return effects
      }
      if (typeof activity === 'string') {
        throw new Error(activity)
      }
      return activity
    }
  const rowOf = (text: string) => within(screen.getByText(text).closest('li')!)

  it("shows every machine's runs, each with its machine and only its own effects, though a run's id is the same on both", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const ranOnMini = testRun({
      id: 'run-a',
      automationId: 'fix-ci',
      status: 'done',
      outcome: 'Fixed on the mini'
    })
    const mini: ActivityPayload = {
      ...payload,
      live: [],
      ticks: [{ ...payload.ticks[0], runs: [ranOnMini] }]
    }
    const pushed = { kind: 'pushed', target: 'web-1', url: null, count: 1, stepIdx: 0, at: 1 }
    pilotRpc.mockImplementation(
      byHost({ local: machine(payload, { 'run-a': [pushed] }), mini: machine(mini) })
    )
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    const today = await screen.findByRole('region', { name: 'Earlier today' })
    expect(await within(today).findByText('Fixed on the mini')).toBeTruthy()
    expect(rowOf('Fixed on the mini').getByText('Mac mini')).toBeTruthy()
    expect(rowOf('!1561 web-1').getByText('MacBook')).toBeTruthy()
    expect(rowOf("Couldn't start: no such repo").getByText('MacBook')).toBeTruthy()
    expect(await rowOf('!1561 web-1').findByText('pushed web-1')).toBeTruthy()
    expect(rowOf('Fixed on the mini').queryByText('pushed web-1')).toBeNull()
  })

  // Both machines have a run-a; Mac mini's ran and ended there.
  const sameIdOnMini = (effects: Record<string, unknown> = {}) => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const ranOnMini = testRun({
      id: 'run-a',
      automationId: 'fix-ci',
      status: 'done',
      outcome: 'Fixed on the mini',
      steps: [stepAt(0, 'fix', 'done')]
    })
    const mini: ActivityPayload = {
      ...payload,
      live: [],
      ticks: [{ ...payload.ticks[0], runs: [ranOnMini] }]
    }
    pilotRpc.mockImplementation(byHost({ local: machine(payload), mini: machine(mini, effects) }))
    render(<ActivityView automationIds={null} since={0} limit={100} />)
  }

  it("shows another machine's run's effects, asked of that machine", async () => {
    const pushed = { kind: 'pushed', target: 'mini-1', url: null, count: 1, stepIdx: 0, at: 1 }
    sameIdOnMini({ 'run-a': [pushed] })
    await screen.findByText('Fixed on the mini')
    expect(await rowOf('Fixed on the mini').findByText('pushed mini-1')).toBeTruthy()
    expect(rowOf('!1561 web-1').queryByText('pushed mini-1')).toBeNull()
  })

  it.each<[string, () => HTMLElement]>([
    ['Open run', () => rowOf('Fixed on the mini').getByRole('button', { name: 'Open run' })],
    [
      'its strip, named by its machine',
      () =>
        within(screen.getByRole('list', { name: 'Run run-a on Mac mini' })).getByRole('button', {
          name: /1 fix/
        })
    ]
  ])(
    "opens another machine's run there from %s, though this machine has a run with its id",
    async (_from, control) => {
      sameIdOnMini()
      await screen.findByText('Fixed on the mini')
      expect(screen.getByRole('list', { name: 'Run run-a on MacBook' })).toBeTruthy()
      fireEvent.click(control())
      expect([openRunPanel()?.runId, openRunPanel()?.host.key]).toEqual(['run-a', 'env:mini'])
    }
  )

  it.each<[string, PilotHostEntry, string]>([
    ['whose read failed', MINI, "Couldn't refresh Mac mini's runs: timed out"],
    [
      "that can't be reached",
      MINI_OFFLINE,
      "Mac mini can't be reached: its runs aren't shown here."
    ]
  ])('names a machine %s, and still shows the rest', async (_w, mini, line) => {
    setPilotHostsForTests([LOCAL_NAMED, mini])
    pilotRpc.mockImplementation(byHost({ local: machine(payload), mini: machine('timed out') }))
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    expect(await screen.findByText(line)).toBeTruthy()
    const running = screen.getByRole('region', { name: 'Running now' })
    expect(within(running).getByText('!1561 web-1')).toBeTruthy()
    expect(screen.queryByText('timed out')).toBeNull()
  })

  it('names the machine on a tick line that started no runs', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const quiet = { ...payload.ticks[0], id: 12, counts: {}, runs: [] }
    pilotRpc.mockImplementation(
      byHost({ local: machine(payload), mini: machine({ ...payload, live: [], ticks: [quiet] }) })
    )
    render(<ActivityView automationIds={null} since={0} limit={100} />)
    const line = within((await screen.findByText('Tick 12')).closest('li')!)
    expect(line.getByText('Mac mini')).toBeTruthy()
  })
})
