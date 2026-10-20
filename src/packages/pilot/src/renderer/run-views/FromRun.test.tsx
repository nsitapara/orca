// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { summary } from '../pages/fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { resetAutomationsFeed } from './automations-feed'
import { FromRun } from './FromRun'
import { closeRunPanel, openRunPanel } from './run-panel-state'

describe('FromRun', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    closeRunPanel()
    resetPilotHostsFeed()
    pilotRpc.mockReset()
    vi.unstubAllGlobals()
  })

  it("shows the run's state and the steps that ran, lights the one that asked, and opens it there", async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    const run = testRun({
      id: 'r1',
      automationId: 'fix-ci',
      itemLabel: '!1477',
      status: 'needs_you',
      costUsd: 1.5,
      steps: [stepAt(0, 'fix', 'done')],
      inbox: [testCard({ automationId: 'fix-ci', stepIdx: 0 })]
    })
    render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={run} />)
    const asked = await screen.findByRole('button', { name: 'Agent · 1 fix · Done' })
    expect(asked.dataset.highlighted).toBe('')
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText('!1477')).toBeTruthy()
    expect(screen.getByText('$1.50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    expect(openRunPanel()).toEqual({
      runId: 'r1',
      part: 'step:0',
      host: expect.objectContaining({ key: 'local' })
    })
  })

  it('says where a failed run stopped', async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    const run = testRun({
      automationId: 'fix-ci',
      status: 'failed',
      finishedAt: 9,
      steps: [stepAt(0, 'fix', 'failed')],
      inbox: [testCard({ automationId: 'fix-ci', stepIdx: 0 })]
    })
    render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={run} />)
    expect(await screen.findByText('Failed at step 1')).toBeTruthy()
  })

  it("opens a card an answer run asked at the answer run's step", async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    const run = testRun({
      id: 'r2',
      automationId: 'fix-ci',
      tickId: null,
      trigger: 'answer',
      parentRunId: 'r1',
      status: 'needs_you',
      steps: [stepAt(0, 'answers', 'done')],
      inbox: [testCard({ automationId: 'fix-ci', runId: 'r2', stepIdx: 0 })]
    })
    render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={run} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open run' }))
    expect(openRunPanel()).toEqual({
      runId: 'r2',
      part: 'answer:0',
      host: expect.objectContaining({ key: 'local' })
    })
  })

  it.each<[string, () => HTMLElement]>([
    ['Open run', () => screen.getByRole('button', { name: 'Open run' })],
    [
      'its strip, named by its machine',
      () =>
        within(screen.getByRole('list', { name: 'Run r1 on Mac mini' })).getByRole('button', {
          name: /1 fix/
        })
    ]
  ])("opens another machine's card's run there from %s", async (_from, control) => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    const run = testRun({
      id: 'r1',
      automationId: 'fix-ci',
      status: 'needs_you',
      steps: [stepAt(0, 'fix', 'done')]
    })
    render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={{ ...run, host: MINI }} />)
    await screen.findByRole('button', { name: /1 fix/ })
    fireEvent.click(control())
    expect([openRunPanel()?.runId, openRunPanel()?.host.key]).toEqual(['r1', 'env:mini'])
  })

  describe('Continue run', () => {
    const FEED = { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
    const failed = (over: Partial<Parameters<typeof testRun>[0]> = {}) =>
      testRun({
        id: 'r1',
        automationId: 'fix-ci',
        status: 'failed',
        finishedAt: 9,
        steps: [stepAt(0, 'fix', 'failed')],
        inbox: [testCard({ automationId: 'fix-ci', stepIdx: 0 })],
        ...over
      })
    const serve = (continued: () => Promise<unknown>) =>
      pilotRpc.mockImplementation(async (method: string) =>
        method === 'pilot.runs.continue' ? continued() : FEED
      )

    it.each([
      [true, 'Continuing from step fix, in its own session'],
      [false, 'Continuing from step fix, started over']
    ])('continues a failed run from its card (session resumed: %s)', async (resumed, note) => {
      serve(async () => ({ step: 'fix', resumed }))
      render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={failed()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Continue run' }))
      expect(await screen.findByText(note)).toBeTruthy()
      expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.continue', { runId: 'r1' })
    })

    it("continues another machine's card's run on that machine, as its Open run does", async () => {
      serve(async () => ({ step: 'fix', resumed: true }))
      render(
        <FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={{ ...failed(), host: MINI }} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Continue run' }))
      expect(await screen.findByText('Continuing from step fix, in its own session')).toBeTruthy()
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.runs.continue',
        { runId: 'r1' },
        { target: MINI.target }
      )
    })

    it("says why when Pilot won't continue it", async () => {
      serve(async () => {
        throw new Error('Every run slot is taken: continue this run once one frees')
      })
      render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={failed()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Continue run' }))
      expect(await screen.findByText(/Every run slot is taken/)).toBeTruthy()
    })

    it.each([
      ['a run still going', failed({ status: 'running', finishedAt: null }), false],
      ['a run waiting on you', failed({ status: 'needs_you' }), false],
      ['a run that ended done', failed({ status: 'done' }), false],
      ['an answer run', failed({ trigger: 'answer', parentRunId: 'r0' }), false],
      [
        'an ask-first run you declined',
        failed({ trigger: 'ask_first', status: 'cancelled', steps: [] }),
        false
      ],
      ['a failed run in the browser version', failed(), true]
    ])('offers nothing for %s', async (_name, run, browser) => {
      vi.stubGlobal('__ORCA_WEB_CLIENT__', browser)
      serve(async () => ({ step: 'fix', resumed: true }))
      render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={run} />)
      await screen.findByRole('button', { name: 'Open run' })
      expect(screen.queryByRole('button', { name: 'Continue run' })).toBeNull()
    })
  })

  it('shows nothing for a card whose run is gone', () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    const { container } = render(
      <FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={null} />
    )
    expect(container.textContent).toBe('')
  })
})
