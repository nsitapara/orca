// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { machineGroups, machineThread } from '../activity-machines/activity-machines-test-fixtures'
import { registerPilotStore } from '../store'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { setActivityHideAutomationRuns } from './activity-tabs-setting'
import { useActivityTabsThreads } from './activity-tabs-threads'
import { askAutomationTabs, resetAutomationTabsForTests } from './hide-automation-runs'

const LOCAL = { kind: 'local' } as const
const PAIRED = { kind: 'environment', environmentId: 'env-2' } as const

// Each host's Pilot says which of the asked tabs a step ran in; `refusing` hosts throw.
function pilotsAnswering(automation: string[], refusing: string[] = []): void {
  pilotRpc.mockImplementation(
    async (_method: string, params: { tabIds: string[] }, opts: { target: { kind: string } }) => {
      const host = opts.target.kind === 'environment' ? 'env-2' : 'local'
      if (refusing.includes(host)) {
        throw new Error('method not found')
      }
      return { tabIds: params.tabIds.filter((id) => automation.includes(id)) }
    }
  )
}

beforeEach(() => {
  resetAutomationTabsForTests()
  pilotRpc.mockReset()
  registerPilotStore(useAppStore)
  useAppStore.setState({ sidebarOpen: true, sidebarBody: 'agents' })
})

afterEach(() => {
  act(() => setActivityHideAutomationRuns(false))
  registerPilotStore(null)
  window.localStorage.clear()
})

describe('Hide automation runs', () => {
  const run = machineThread('run')
  const mine = machineThread('mine')
  const pairedRun = machineThread('paired', 'runtime:env-2')

  function renderThreads() {
    return renderHook(() =>
      useActivityTabsThreads(
        {
          allThreads: [run, mine, pairedRun],
          effectiveSelectedPaneKey: null,
          visibleThreadGroups: [
            ...machineGroups(run, mine),
            { ...machineGroups(pairedRun)[0], key: 'paired' }
          ]
        },
        { query: '', readFilter: 'all', groupBy: 'status' }
      )
    )
  }

  const paneKeys = (r: ReturnType<typeof renderThreads>) =>
    r.result.current.visibleThreadGroups.flatMap((g) => g.threads.map((t) => t.paneKey))

  it.each([
    { name: 'every host answers', refusing: [], shown: ['mine'] },
    {
      name: 'the paired host refuses (unreachable, or an older build)',
      refusing: ['env-2'],
      shown: ['mine', 'paired']
    }
  ])(
    'leaves out the sessions a Pilot step ran in, asked of each row’s own host: $name',
    async ({ refusing, shown }) => {
      pilotsAnswering(['tab-run', 'tab-paired'], refusing)
      act(() => setActivityHideAutomationRuns(true))
      const r = renderThreads()
      await waitFor(() => expect(paneKeys(r)).toEqual(shown))
      expect(pilotRpc.mock.calls).toEqual([
        ['pilot.runs.automationTabs', { tabIds: ['tab-run', 'tab-mine'] }, { target: LOCAL }],
        ['pilot.runs.automationTabs', { tabIds: ['tab-paired'] }, { target: PAIRED }]
      ])
    }
  )

  it('lists every session and asks nothing while off', () => {
    pilotsAnswering(['tab-run'])
    expect(paneKeys(renderThreads())).toEqual(['run', 'mine', 'paired'])
    expect(pilotRpc).not.toHaveBeenCalled()
  })
})

// A step records its pane just after its tab opens, so a "no" is asked again for a minute; a "yes" stands.
describe('askAutomationTabs', () => {
  const tab = (tabId: string) => ({ tabId, target: LOCAL })
  const asked = () => pilotRpc.mock.calls.flatMap(([, params]) => params.tabIds)

  it.each([
    { name: 'a "no" within the minute', automation: [], later: 59_000, again: ['tab-a'] },
    { name: 'a "no" after the minute', automation: [], later: 61_000, again: [] },
    { name: 'a "yes"', automation: ['tab-a'], later: 1_000, again: [] }
  ])('asks again after $name: $again', async ({ automation, later, again }) => {
    pilotsAnswering(automation)
    await askAutomationTabs([tab('tab-a')], 0)
    pilotRpc.mockClear()
    await askAutomationTabs([tab('tab-a')], later)
    expect(asked()).toEqual(again)
  })
})
