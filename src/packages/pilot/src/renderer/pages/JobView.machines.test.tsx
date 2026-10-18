// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationSummary } from '../../shared/api-types'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../hosts/__fixtures__/hosts'
import type { PilotHostEntry } from '../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { resetAutomationsFeed } from '../run-views/automations-feed'
import { detail, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { JobView } from './JobView'

const stage = (
  id: string,
  n: number,
  over: Partial<AutomationSummary> = {}
): AutomationSummary => ({
  ...summary,
  id,
  name: `13 · stage ${n}`,
  enabled: false,
  job: { id: '13', name: 'Fix red e2e', stage: n, label: `Work ${n}`, feeds: [] },
  ...over
})
const ONE = stage('dev-e2e-fix', 1)
const TWO = stage('dev-e2e-fix-start', 2)

function idOf(params: unknown): string | undefined {
  return typeof params === 'object' &&
    params !== null &&
    'id' in params &&
    typeof params.id === 'string'
    ? params.id
    : undefined
}

// A machine's answers: its list, each stage's detail, no Activity, an ok tick; a string is what its every call throws.
const answersFrom =
  (automations: AutomationSummary[] | string) => (method: string, params?: unknown) => {
    if (typeof automations === 'string') {
      throw new Error(automations)
    }
    if (method === 'pilot.automations.list') {
      return { automations, errors: [], peopleError: null, missingDirs: [] }
    }
    if (method === 'pilot.automations.get') {
      return { ...detail, summary: automations.find((a) => a.id === idOf(params)) ?? summary }
    }
    if (method === 'pilot.activity.list') {
      return { live: [], ticks: [], loose: [], reach: null }
    }
    return { tickId: null, status: 'ok', error: null, decisions: [] }
  }
const calls = (method: string) => pilotRpc.mock.calls.filter((c) => c[0] === method)

describe('JobView on more than one machine', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    resetAutomationsFeed()
    resetPilotHostsFeed()
    localStorage.clear()
  })

  it("asks each stage's own machine for its data, and dry-runs and turns on each stage there", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: answersFrom([ONE, TWO]),
        mini: answersFrom([ONE, { ...TWO, ticksHere: true }])
      })
    )
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run all' }))
    await screen.findAllByText('Nothing was started or saved.')
    expect(calls('pilot.automations.get')).toEqual([
      ['pilot.automations.get', { id: 'dev-e2e-fix' }],
      ['pilot.automations.get', { id: 'dev-e2e-fix-start' }, { target: MINI.target }]
    ])
    expect(calls('pilot.automations.dryRun')).toEqual([
      ['pilot.automations.dryRun', { id: 'dev-e2e-fix' }, { timeoutMs: 180_000 }],
      [
        'pilot.automations.dryRun',
        { id: 'dev-e2e-fix-start' },
        { timeoutMs: 180_000, target: MINI.target }
      ]
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('pilot.automations.setEnabled')).toHaveLength(2))
    expect(calls('pilot.automations.setEnabled')).toEqual([
      ['pilot.automations.setEnabled', { id: 'dev-e2e-fix', enabled: true }],
      [
        'pilot.automations.setEnabled',
        { id: 'dev-e2e-fix-start', enabled: true },
        { target: MINI.target }
      ]
    ])
  })

  it.each<[string, PilotHostEntry, AutomationSummary[], string[]]>([
    [
      "a stage's runs_on machine's list failed",
      MINI,
      [ONE, { ...TWO, runsOn: 'Mac mini' }],
      ['dev-e2e-fix']
    ],
    [
      "a stage's runs_on machine is offline",
      MINI_OFFLINE,
      [ONE, { ...TWO, runsOn: 'mac mini' }],
      ['dev-e2e-fix']
    ],
    ['no answered list has the job while a machine failed', MINI, [], []]
  ])(
    'sends no action, and reads no stage from the wrong machine, saying why in red, when %s',
    async (_w, mini, here, read) => {
      setPilotHostsForTests([LOCAL_NAMED, mini])
      pilotRpc.mockImplementation(
        byHost({ local: answersFrom(here), mini: answersFrom('timed out') })
      )
      render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
      const why = await screen.findByText(
        "Mac mini isn't answering, so this job can't be changed from here right now."
      )
      expect(why.className).toContain('text-destructive')
      expect(screen.queryByRole('button', { name: 'Dry run all' })).toBeNull()
      expect(calls('pilot.automations.get').map((c) => idOf(c[1]))).toEqual(read)
      expect(
        pilotRpc.mock.calls.filter(
          (c) =>
            !['pilot.automations.list', 'pilot.automations.get', 'pilot.activity.list'].includes(
              c[0]
            )
        )
      ).toEqual([])
    }
  )
})
