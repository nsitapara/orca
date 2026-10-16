// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
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
    pilotRpc.mockReset()
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
    expect(openRunPanel()).toEqual({ runId: 'r1', part: 'step:0' })
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
    expect(openRunPanel()).toEqual({ runId: 'r2', part: 'answer:0' })
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
