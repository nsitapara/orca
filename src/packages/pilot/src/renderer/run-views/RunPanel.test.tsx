// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunDetail, RunStatus, RunTrigger } from '../../shared/api-types'
import type { RunEnv } from '../../shared/api-types-env'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { chainOf, type ChainPart } from '../../shared/run-views/chain'
import { byHost, LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from '../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
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
const activate = vi.fn()
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activate(...args)
}))

import { registerPilotStore } from '../store'
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
  answerRuns: [],
  mergeBack: null
}

describe('the run panel', () => {
  afterEach(() => {
    cleanup()
    closeRunPanel()
    clearPendingInboxCard()
    showAutomationsPage()
    resetEffectsFeed()
    pilotRpc.mockReset()
    vi.unstubAllGlobals()
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

  it('says what a context-preparation run prepares, and opens the run that asked and its card', async () => {
    pilotRpc.mockResolvedValue({
      ...detail,
      run: { ...detail.run, inbox: [] },
      preparation: {
        cardId: 'c9',
        cardTitle: 'Use a middot?',
        askedBy: '03 · Review and fix branch code',
        askedInRun: 'rev-1',
        needs: ['context', 'diff'],
        attempt: 2,
        maxAttempts: 3,
        lastError: 'Preparation lease expired'
      }
    })
    openRun('r1', null)
    render(<RunPanelHost />)
    await screen.findByText('Preparing')
    const fact = (name: string) =>
      screen.getByText(name, { selector: 'dt' }).nextSibling?.textContent
    expect([fact('Preparing'), fact('Asked by'), fact('Try')]).toEqual([
      'decision context, code diff for the card above · Open card',
      '03 · Review and fix branch code in run rev-1',
      '2 of 3 · the last try ended: Preparation lease expired'
    ])
    fireEvent.click(screen.getByRole('button', { name: 'run rev-1' }))
    expect(openRunPanel()?.runId).toBe('rev-1')
    // The asking run's panel loads; the mock answers it with the same detail.
    fireEvent.click(await screen.findByRole('button', { name: 'Open card' }))
    expect([pilotAutomationsView(), pendingInboxCard(), openRunPanel()]).toEqual([
      'inbox',
      'c9',
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

  // A paired device may stop a run (methods-runs.ts), so the browser offers Stop; a shell-only job's run can't stop.
  const shellOnly = testDefinition({
    id: 'fix-ci',
    steps: [testStep({ name: 'pull', agent: 'shell', run: 'git pull', prompt: null })]
  })
  it.each<[string, RunStatus, boolean, ChainPart[], number]>([
    ['a running run', 'running', false, detail.chain, 1],
    ['a run waiting on you', 'needs_you', false, detail.chain, 0],
    ['a running run in the browser version', 'running', true, detail.chain, 1],
    ["a shell-only job's running run", 'running', false, chainOf(shellOnly, [shellOnly]), 0]
  ])('offers Stop on a running run only: %s', async (_n, status, web, chain, offers) => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', web)
    const shown: RunDetail = { ...detail, chain, run: { ...detail.run, status } }
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.runs.stop' ? { stopped: true } : shown
    )
    openRun('r1')
    render(<RunPanelHost />)
    await screen.findByRole('link', { name: '!1561 web-1' })
    expect(screen.queryAllByRole('button', { name: 'Stop' })).toHaveLength(offers)
    if (offers === 0) {
      return
    }
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    // Enter answers Cancel, never Stop run.
    expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.stop', { runId: 'r1' }))
  })

  it.each<[string, RunTrigger, string]>([
    [
      'an answer run',
      'answer',
      "Its agent's tab closes, and the cards it was answering go back to your Inbox."
    ],
    [
      'any other run',
      'schedule',
      "Its agent's tab closes. You can pick it up again from Recently finished."
    ]
  ])("words Stop's dialog for %s", async (_n, trigger, text) => {
    const shown: RunDetail = { ...detail, run: { ...detail.run, status: 'running', trigger } }
    pilotRpc.mockResolvedValue(shown)
    openRun('r1')
    render(<RunPanelHost />)
    await screen.findByRole('link', { name: '!1561 web-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText(text)).toBeTruthy()
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

describe("the run panel, for another machine's run", () => {
  afterEach(() => {
    cleanup()
    closeRunPanel()
    clearPendingInboxCard()
    showAutomationsPage()
    resetEffectsFeed()
    resetPilotHostsFeed()
    registerPilotStore(null)
    pilotRpc.mockReset()
    activate.mockReset()
  })

  // Only Mac mini answers, so a call that reaches this machine fails.
  const onMini = (run: RunDetail, answers: Record<string, unknown> = {}): void => {
    pilotRpc.mockImplementation(
      byHost({
        mini: (method) => (method === 'pilot.runs.get' ? run : (answers[method] ?? {}))
      })
    )
  }

  it('reads a remote run from its machine, and its links open on the same machine', async () => {
    onMini({ ...detail, run: { ...detail.run, parentRunId: 'r0' } })
    openRun('r1', null, MINI)
    render(<RunPanelHost />)
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.runs.get',
        { runId: 'r1' },
        { target: MINI.target }
      )
    )
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.runs.effects',
        { runIds: ['r1'] },
        { target: MINI.target }
      )
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Answers run r0' }))
    expect(openRunPanel()?.host.key).toBe('env:mini')
  })

  it.each<[string, PilotHostEntry[], PilotHostEntry, boolean]>([
    ['more than one machine listed', [LOCAL_NAMED, MINI], MINI, true],
    ['one machine', [LOCAL_PILOT_HOST], LOCAL_PILOT_HOST, false]
  ])("names the run's machine in its header: %s", async (_w, hosts, host, named) => {
    setPilotHostsForTests(hosts)
    const answer = (method: string) => (method === 'pilot.runs.get' ? detail : {})
    pilotRpc.mockImplementation(byHost({ local: answer, mini: answer }))
    openRun('r1', null, host)
    render(<RunPanelHost />)
    const crumbs = within(await screen.findByRole('navigation', { name: 'Crumbs' }))
    expect(crumbs.queryByText(host.machineName) !== null).toBe(named)
  })

  it("opens a run its timeline links to on the panel's machine", async () => {
    const handover = {
      id: 1,
      senderId: 'triage',
      senderRunId: 'r0',
      receiverId: 'fix-ci',
      itemId: '!1561',
      createdAt: 1,
      state: 'consumed' as const,
      consumedAt: 2,
      tickId: 7,
      verdict: null,
      reason: null,
      runId: 'r1'
    }
    onMini({ ...detail, receivedFrom: [handover] })
    openRun('r1', 'starts', MINI)
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open run' }))
    expect([openRunPanel()?.runId, openRunPanel()?.host.key]).toEqual(['r0', 'env:mini'])
  })

  it("opens a remote run's card in the Inbox on its machine", async () => {
    onMini(detail)
    openRun('r1', null, MINI)
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open card' }))
    expect(pendingInboxCard()).toBe('env:mini/c1')
  })

  it('continues a remote run on its machine', async () => {
    const broken: RunDetail = {
      ...detail,
      run: { ...detail.run, status: 'failed', finishedAt: 9, steps: [stepAt(0, 'fix', 'failed')] }
    }
    onMini(broken, { 'pilot.runs.continue': { step: 'fix', resumed: true } })
    openRun('r1', null, MINI)
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue run' }))
    expect(await screen.findByText('Continuing from step fix, in its own session')).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith(
      'pilot.runs.continue',
      { runId: 'r1' },
      { target: MINI.target }
    )
  })

  it("opens a remote run's worktree on its machine, though this machine has the same worktree id", async () => {
    registerPilotStore({
      getState: () => ({
        rightSidebarOpen: false,
        setRightSidebarOpen: () => {},
        worktreesByRepo: {
          'repo-1': [
            { id: 'a', path: '/w/x' },
            { id: 'a', path: '/w/x', runtimeOwnerEnvironmentId: 'mini' }
          ]
        }
      })
    })
    onMini({ ...detail, run: { ...detail.run, worktreePath: '/w/x' } })
    openRun('r1', null, MINI)
    render(<RunPanelHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'x' }))
    await waitFor(() =>
      expect(activate).toHaveBeenCalledWith('a', { executionHostId: 'runtime:mini' })
    )
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it("never shows this machine's run in place of another machine's run with the same id", async () => {
    pilotRpc.mockImplementation(
      byHost({
        local: (method) => (method === 'pilot.runs.get' ? detail : {}),
        mini: () => {
          throw new Error('Mac mini timed out')
        }
      })
    )
    openRun('r1')
    render(<RunPanelHost />)
    expect(await screen.findByRole('link', { name: '!1561 web-1' })).toBeTruthy()
    act(() => openRun('r1', null, MINI))
    expect(await screen.findByText('Mac mini timed out')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '!1561 web-1' })).toBeNull()
  })
})
