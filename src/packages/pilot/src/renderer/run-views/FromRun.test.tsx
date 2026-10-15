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

  it('shows the run that asked, lit where it asked, and opens it there', async () => {
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
      steps: [stepAt(0, 'fix', 'done')],
      inbox: [testCard({ automationId: 'fix-ci', stepIdx: 0 })]
    })
    render(<FromRun item={{ automationId: 'fix-ci', stepIdx: 0 }} run={run} />)
    expect(
      await screen.findByRole('button', { name: 'Agent · Claude · fix-gitlab-ci · Waiting on you' })
    ).toBeTruthy()
    expect(screen.getByText('!1477 · step 1 of 1 asked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    expect(openRunPanel()).toEqual({ runId: 'r1', part: 'step:0' })
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
