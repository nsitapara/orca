// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunDetail } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { chainOf } from '../../shared/run-views/chain'
import {
  clearPendingInboxCard,
  pendingInboxCard,
  pilotAutomationTab,
  pilotAutomationsView,
  pilotOpenAutomation,
  showAutomationsPage
} from '../pages/automations-view'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { RunPanelHost } from './RunPanelHost'
import { closeRunPanel, openRun, openRunPanel } from './run-panel-state'

const def = testDefinition({
  id: 'fix-ci',
  steps: [testStep({ name: 'fix', skill: 'fix-gitlab-ci' })]
})
const detail: RunDetail = {
  run: {
    ...testRun({
      id: 'r1',
      automationId: 'fix-ci',
      itemLabel: '!1561 web-1',
      status: 'needs_you',
      steps: [stepAt(0, 'fix', 'done')],
      inbox: [testCard({ id: 'c1', automationId: 'fix-ci', stepIdx: 0 })]
    }),
    fields: { 'mr.web_url': 'https://gitlab.example/mr/1561' }
  },
  automationName: '05 · Fix failed CI',
  chain: chainOf(def, [def]),
  tickItem: null,
  trigger: null,
  handovers: [],
  answerRuns: []
}

describe('the run panel', () => {
  afterEach(() => {
    cleanup()
    closeRunPanel()
    clearPendingInboxCard()
    showAutomationsPage()
    pilotRpc.mockReset()
  })

  it('shows the run with its item linked out, at the part it was opened at, and goes to the card it waits on', async () => {
    pilotRpc.mockResolvedValue(detail)
    openRun('r1', 'step:0')
    const { container } = render(<RunPanelHost />)
    const item = await screen.findByRole('link', { name: '!1561 web-1' })
    expect(item.getAttribute('href')).toBe('https://gitlab.example/mr/1561')
    expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.get', { runId: 'r1' })
    expect(container.querySelector('[data-part="step:0"]')?.getAttribute('data-highlighted')).toBe(
      ''
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open card' }))
    expect([pilotAutomationsView(), pendingInboxCard(), openRunPanel()]).toEqual([
      'inbox',
      'c1',
      null
    ])
  })

  it("opens the automation's How it runs from its crumb, and closes on Escape", async () => {
    pilotRpc.mockResolvedValue(detail)
    openRun('r1')
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: '05 · Fix failed CI' }))
    expect([pilotOpenAutomation(), pilotAutomationTab(), openRunPanel()]).toEqual([
      'fix-ci',
      'how',
      null
    ])
    act(() => openRun('r1'))
    expect(await screen.findByRole('complementary', { name: 'Run' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(openRunPanel()).toBeNull()
  })
})
