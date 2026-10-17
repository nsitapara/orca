// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivityPayload,
  AutomationSummary,
  RunDetail,
  TickOutcome
} from '../../shared/api-types'
import { byHost, LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { resetAutomationsFeed } from '../run-views/automations-feed'
import { closeRunPanel, openRunPanel } from '../run-views/run-panel-state'
import { detail, failedRunTick, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AutomationView } from './AutomationView'
import { setPilotAutomationTab } from './automations-view'

const ACTIVITY: ActivityPayload = { live: [], ticks: [failedRunTick], loose: [], reach: null }
const EMPTY: ActivityPayload = { live: [], ticks: [], loose: [], reach: null }
const RUN: RunDetail = {
  run: { ...failedRunTick.runs[0], fields: {} },
  automationName: summary.name,
  chain: summary.chain,
  tickItem: null,
  trigger: null,
  handovers: [],
  receivedFrom: [],
  answerRuns: []
}

function serve(outcome: TickOutcome = { status: 'busy' }): void {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.automations.get') {
      return detail
    }
    if (method === 'pilot.activity.list') {
      return ACTIVITY
    }
    if (method === 'pilot.runs.get') {
      return RUN
    }
    if (method === 'pilot.automations.list') {
      return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
    }
    return outcome
  })
}

const calls = (method: string): unknown[][] => pilotRpc.mock.calls.filter((c) => c[0] === method)

describe('AutomationView', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    localStorage.clear()
    resetAutomationsFeed()
    resetPilotHostsFeed()
    closeRunPanel()
    setPilotAutomationTab('how')
  })

  it('opens on How it runs: the facts and the plan with no run painted on it, and its latest run opens the run', async () => {
    serve()
    const { container } = render(
      <AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />
    )
    expect(await screen.findByRole('tab', { name: 'How it runs', selected: true })).toBeTruthy()
    expect(screen.getByText('Run by hand (America/Los_Angeles)')).toBeTruthy()
    expect(await screen.findByText('Latest run')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(container.querySelector('[data-part="workspace"]')).toBeTruthy()
    expect(container.querySelector('[data-state]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    expect(openRunPanel()).toEqual({
      runId: 'fix-ci-3',
      part: null,
      host: expect.objectContaining({ key: 'local' })
    })
    closeRunPanel()
  })

  it('opens the latest run on the machine it ran on', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    // A machine's answers, with its own Activity.
    const machine = (activity: ActivityPayload) => (method: string) => {
      if (method === 'pilot.activity.list') {
        return activity
      }
      if (method === 'pilot.automations.list') {
        return { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
      }
      return method === 'pilot.automations.get' ? detail : {}
    }
    pilotRpc.mockImplementation(byHost({ local: machine(EMPTY), mini: machine(ACTIVITY) }))
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    expect(await screen.findByText('Latest run')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    expect([openRunPanel()?.runId, openRunPanel()?.host.key]).toEqual(['fix-ci-3', 'env:mini'])
  })

  it('shows its Activity, asking only for this automation and only ticks with something to do', async () => {
    serve()
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/Couldn't start: no such repo/)).toBeTruthy()
    expect(calls('pilot.activity.list').at(-1)?.[1]).toEqual({
      automationIds: ['fix-ci'],
      since: undefined,
      limit: 30,
      skipQuiet: true
    })
  })

  it('shows its YAML', async () => {
    serve()
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
    expect(screen.getByText(/schedule: manual/)).toBeTruthy()
  })

  it("names a stage's page by its stage, and its crumbs lead to the job's page and to the list", async () => {
    const stage = (id: string, n: number, label: string): AutomationSummary => ({
      ...summary,
      id,
      name: `13 · stage ${n}`,
      job: {
        id: '13',
        name: n === 1 ? 'Fix red hourly e2e on dev' : null,
        stage: n,
        label,
        feeds: []
      }
    })
    const second = stage('dev-e2e-fix-start', 2, 'Start a fix session per ticket')
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.automations.get') {
        return { ...detail, summary: second }
      }
      if (method === 'pilot.automations.list') {
        return {
          automations: [summary, stage('dev-e2e-fix', 1, 'Open or update the ticket'), second],
          errors: [],
          peopleError: null,
          missingDirs: []
        }
      }
      return EMPTY
    })
    const onBack = vi.fn()
    const onOpenJob = vi.fn()
    render(<AutomationView id="dev-e2e-fix-start" onBack={onBack} onOpenJob={onOpenJob} />)
    expect(
      await screen.findByRole('heading', { name: 'Stage 2 of 2 · Start a fix session per ticket' })
    ).toBeTruthy()
    expect(screen.getByText('Stage 2 · Start a fix session per ticket')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '13 · Fix red hourly e2e on dev' }))
    expect(onOpenJob).toHaveBeenCalledWith('13')
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('Run now needs a Confirm before it calls tickNow, with the long timeout', async () => {
    serve({ tickId: 12, status: 'ok', error: null, decisions: [] })
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
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
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toHaveLength(0)
  })

  it('Dry run needs no confirm, disables both buttons while running, then shows what would happen', async () => {
    let finish: (v: TickOutcome) => void = () => {}
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.automations.get') {
        return Promise.resolve(detail)
      }
      if (method === 'pilot.activity.list') {
        return Promise.resolve(EMPTY)
      }
      return new Promise<TickOutcome>((resolve) => {
        finish = resolve
      })
    })
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
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
    const before = calls('pilot.activity.list').length
    finish({
      tickId: null,
      status: 'ok',
      error: null,
      decisions: [
        {
          key: 'linear:WEB-2152',
          label: 'WEB-2152',
          verdict: 'started',
          reason: 'All checks pass',
          checks: [],
          onceKey: 'WEB-2152',
          fields: { 'ticket.url': 'https://linear.app/herasight/issue/WEB-2152' }
        }
      ]
    })
    expect(await screen.findByText('1 checked · 1 would start')).toBeTruthy()
    expect(screen.getByText('Nothing was started or saved.')).toBeTruthy()
    expect(screen.getByText('Would start')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'WEB-2152' }).getAttribute('href')).toBe(
      'https://linear.app/herasight/issue/WEB-2152'
    )
    // Nothing was stored, so Activity isn't reloaded.
    expect(calls('pilot.activity.list')).toHaveLength(before)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('1 checked · 1 would start')).toBeNull()
  })

  it.each([
    [{ status: 'busy' as const }, 'Tick already running'],
    [{ status: 'unknown' as const }, 'No automation fix-ci']
  ])('reports %j', async (outcome, text) => {
    serve(outcome)
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('shows the error when the call itself fails', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.automations.get') {
        return detail
      }
      if (method === 'pilot.activity.list') {
        return EMPTY
      }
      throw new Error("Pilot isn't running: store won't open")
    })
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText("Pilot isn't running: store won't open")).toBeTruthy()
  })

  it('fires tickNow once for a double Confirm', async () => {
    serve({ tickId: 1, status: 'ok', error: null, decisions: [] })
    render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
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
      if (method === 'pilot.activity.list') {
        return Promise.resolve(EMPTY)
      }
      return new Promise<TickOutcome>((resolve) => {
        finish = resolve
      })
    })
    const { unmount } = render(
      <AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }))
    unmount()
    const before = calls('pilot.activity.list').length
    finish({ status: 'busy' })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls('pilot.activity.list')).toHaveLength(before)
  })
})
