// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunDetail, RunStatus } from '../../shared/api-types'
import type { RunEnv } from '../../shared/api-types-env'
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

import { resetEffectsFeed } from './effects-feed'
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
  receivedFrom: [],
  answerRuns: []
}

describe('the run panel', () => {
  afterEach(() => {
    cleanup()
    closeRunPanel()
    clearPendingInboxCard()
    showAutomationsPage()
    resetEffectsFeed()
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

  it('offers Continue run in the header of a failed run, and continues it from there', async () => {
    const broken: RunDetail = {
      ...detail,
      run: { ...detail.run, status: 'failed', finishedAt: 9, steps: [stepAt(0, 'fix', 'failed')] }
    }
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.runs.continue' ? { step: 'fix', resumed: true } : broken
    )
    openRun('r1')
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue run' }))
    expect(await screen.findByText('Continuing from step fix, in its own session')).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.continue', { runId: 'r1' })
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

  const env = (over: Partial<RunEnv>): RunEnv => ({
    state: 'ready',
    mode: 'throwaway',
    reason: 'uncommitted changes',
    path: '/tmp/t',
    sha: null,
    envFile: null,
    vars: {},
    stack: null,
    removedAt: null,
    deleteError: null,
    deleteAttempts: 0,
    ...over
  })

  it.each([
    [
      'a throwaway with a stack and a failing delete',
      'done' as RunStatus,
      env({
        stack: {
          kind: 'backend',
          project: 'agents-r1',
          urls: { api: 'http://localhost:8123' },
          log: null
        },
        deleteError: 'docker said no',
        deleteAttempts: 2
      }),
      [
        'Worked in a throwaway: uncommitted changes',
        'backend stack agents-r1 · api http://localhost:8123',
        "Couldn't remove it yet (2 tries): docker said no"
      ]
    ],
    [
      'a preparing run',
      'running' as RunStatus,
      env({ state: 'preparing', mode: null, reason: null }),
      ['Preparing its workspace']
    ],
    [
      'a deferred run',
      'cancelled' as RunStatus,
      env({ state: 'deferred', mode: null, reason: 'busy' }),
      ['Deferred: busy']
    ],
    [
      'an ended run whose delete pilotcli refused',
      'done' as RunStatus,
      env({ state: 'stuck', deleteError: 'dirty' }),
      ['pilotcli refused to remove it (dirty); remove it by hand']
    ]
  ])('says where the run worked: %s', async (_name, status, runEnv, texts) => {
    pilotRpc.mockResolvedValue({ ...detail, run: { ...detail.run, status, env: runEnv } })
    openRun('r1')
    render(<RunPanelHost />)
    for (const text of texts) {
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0)
    }
  })

  it('shows no cleanup line while the run still goes', async () => {
    const runEnv = env({ deleteError: 'docker said no', deleteAttempts: 1 })
    pilotRpc.mockResolvedValue({
      ...detail,
      run: { ...detail.run, status: 'running', env: runEnv }
    })
    openRun('r1')
    render(<RunPanelHost />)
    await screen.findAllByText('Worked in a throwaway: uncommitted changes')
    expect(screen.queryByText(/Couldn't remove it yet/)).toBeNull()
  })

  it("asks once for a finished run's effects when it opens", async () => {
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.runs.get' ? detail : {}
    )
    openRun('r1')
    render(<RunPanelHost />)
    await screen.findAllByText('!1561 web-1')
    await act(async () => {})
    expect(pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.runs.effects')).toHaveLength(1)
  })

  it('shows what the run changed outside Pilot, linked', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.runs.effects') {
        return {
          r1: [
            {
              kind: 'mr_opened',
              target: '!9',
              url: 'https://gitlab.example/mr/9',
              count: 1,
              stepIdx: 0,
              at: 1
            }
          ]
        }
      }
      return method === 'pilot.runs.get' ? detail : null
    })
    openRun('r1')
    render(<RunPanelHost />)
    expect(await screen.findByRole('heading', { name: 'What it changed' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'opened !9 ↗' }).getAttribute('href')).toBe(
      'https://gitlab.example/mr/9'
    )
  })
})
