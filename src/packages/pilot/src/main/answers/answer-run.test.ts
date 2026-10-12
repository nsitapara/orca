import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxItemRow } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import { dispatchToAgent, type AgentDispatchDeps } from './answer-run'
import { DraftInProgressError } from './session-probe'
import type { TerminalState } from './sessions'

const parsed = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, skill: fix-gitlab-ci, prompt: x } ]\npowers: [commit, push]\ninbox: nish\n',
  '/a/ci.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const def = parsed.definition
const NOW = 1_800_000_000_000

function setup(state: TerminalState, over: Partial<AgentDispatchDeps> = {}) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-answer-run-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561 web-1493',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'fix-gitlab-ci',
    startedAt: 1
  })
  store.runs.updateStep('run-1', 0, {
    status: 'done',
    terminalHandle: 'term-1',
    paneKey: 'tab:leaf',
    sessionId: 'sess-1',
    launchArgs: ['--model', 'opus']
  })
  const deps: AgentDispatchDeps = {
    store,
    now: () => NOW,
    probe: {
      terminalState: async () => state,
      transcript: () => ({ size: 10, mtimeMs: NOW })
    },
    quota: async () => ({ weekly: 10, session: 10 }),
    open: vi
      .fn()
      .mockResolvedValue({ terminalHandle: 'term-2', paneKey: 'tab2:leaf', sessionId: 'sess-2' }),
    send: vi.fn().mockResolvedValue(undefined),
    mainCheckout: async () => '/main',
    ...over
  }
  const item = {
    id: 'in_a',
    automationId: 'ci',
    runId: 'run-1',
    stepIdx: 0,
    itemKey: 'mr:1561',
    title: 'Which image?',
    createdAt: 5,
    answer: { option: null, text: 'e2e', digest: 'd', via: 'device', callerKind: 'paired-device' }
  } as InboxItemRow
  return {
    store,
    deps,
    group: {
      def,
      worktreePath: '/wt' as string | null,
      rowId: 7,
      answers: [{ item, revise: false, needsAgent: null }]
    }
  }
}

const RUN_ID = 'ci-202701150800-answer-7'

describe('dispatchToAgent', () => {
  it('types the answers into the free tab that asked, as an answer run of the asking run', async () => {
    const { store, deps, group } = setup('free')
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'dispatched',
      runId: RUN_ID,
      route: 'resume',
      sessionId: 'sess-1'
    })
    expect(vi.mocked(deps.send).mock.calls[0][0]).toBe('term-1')
    expect(vi.mocked(deps.send).mock.calls[0][1]).toContain('[in_a] "Which image?" → e2e')
    expect(deps.open).not.toHaveBeenCalled()
    expect(store.runs.get(RUN_ID)).toMatchObject({
      trigger: 'answer',
      parentRunId: 'run-1',
      status: 'running',
      worktreePath: '/wt',
      itemLabel: '!1561 web-1493'
    })
    // The step runs in the asking process, under the args that process was launched with.
    expect(store.runs.steps(RUN_ID)[0]).toMatchObject({
      name: 'answers',
      status: 'running',
      terminalHandle: 'term-1',
      sessionId: 'sess-1',
      launchArgs: ['--model', 'opus']
    })
    expect(store.events.forRun(RUN_ID)).toMatchObject([
      { kind: 'answer_run', payload: { answer: 'e2e', items: ['in_a'] } }
    ])
  })

  it('forks the asking session in a new tab when its tab is gone, recording the launch args', async () => {
    const { store, deps, group } = setup('gone')
    expect(await dispatchToAgent(deps, group)).toMatchObject({ route: 'fork', sessionId: 'sess-2' })
    expect(deps.open).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        stepName: 'answers',
        agent: 'claude',
        powers: ['commit', 'push'],
        worktree: { id: null, path: '/wt' },
        title: 'Fix CI · answers',
        args: [],
        session: { kind: 'fork', sessionId: 'sess-1' }
      })
    )
    expect(store.runs.steps(RUN_ID)[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term-2',
      paneKey: 'tab2:leaf',
      launchArgs: []
    })
  })

  it('opens a new answers-mode session with the wrapped prompt when nothing can be resumed', async () => {
    const { store, deps, group } = setup('gone', {
      probe: { terminalState: async () => 'gone', transcript: () => null }
    })
    await dispatchToAgent(deps, group)
    const req = vi.mocked(deps.open).mock.calls[0][0]
    expect(req.session).toEqual({ kind: 'new' })
    expect(req.prompt.split('\n')[0]).toBe(
      `Started by the Pilot automation "Fix CI" (run ${RUN_ID}) for !1561 web-1493.`
    )
    expect(store.runs.steps(RUN_ID)[0]).toMatchObject({ mode: 'answers', launchArgs: [] })
  })

  it.each<[string, Partial<AgentDispatchDeps>, { holdReason: string; holdDetail: string }]>([
    [
      'quota',
      { quota: async () => ({ weekly: 95, session: 1 }) },
      { holdReason: 'quota', holdDetail: 'claude weekly limit at 95% (automations stop at 90%)' }
    ],
    [
      'a failed launch',
      { open: vi.fn().mockRejectedValue(new Error('worktree is gone')) },
      { holdReason: 'retry', holdDetail: 'worktree is gone' }
    ],
    [
      "a tab that can't be looked at",
      {
        probe: {
          terminalState: async () => {
            throw new Error('runtime not ready')
          },
          transcript: () => null
        }
      },
      { holdReason: 'retry', holdDetail: 'the asking tab could not be read: runtime not ready' }
    ]
  ])('holds on %s', async (_name, over, held) => {
    const { deps, group } = setup('gone', over)
    expect(await dispatchToAgent(deps, group)).toEqual({ kind: 'held', hold: held })
  })

  it('fails the answer run it opened when the launch fails', async () => {
    const { store, deps, group } = setup('gone', {
      open: vi.fn().mockRejectedValue(new Error('worktree is gone'))
    })
    await dispatchToAgent(deps, group)
    expect(store.runs.get(RUN_ID)).toMatchObject({
      status: 'failed',
      outcome: "Couldn't start: worktree is gone"
    })
  })

  it('holds while another automation holds the worktree claim', async () => {
    const { store, deps, group } = setup('free')
    store.queue.claim('/wt', 'review-cycles', NOW + 60_000, NOW)
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'held',
      hold: { holdReason: 'claimed', holdDetail: 'another automation is applying answers there' }
    })
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('cancels the answer run when someone starts typing just before the answers are sent', async () => {
    const { store, deps, group } = setup('free', {
      send: vi.fn().mockRejectedValue(new DraftInProgressError('term-1'))
    })
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'held',
      hold: { holdReason: 'typing', holdDetail: 'someone is typing in the tab that asked' }
    })
    expect(store.runs.get(RUN_ID)).toMatchObject({ status: 'cancelled' })
  })

  it('gives a retried dispatch in the same minute its own run', async () => {
    const { store, deps, group } = setup('gone', {
      open: vi.fn().mockRejectedValue(new Error('worktree is gone'))
    })
    await dispatchToAgent(deps, group)
    await dispatchToAgent(deps, group)
    expect(store.runs.get(`${RUN_ID}-2`)).toMatchObject({ trigger: 'answer', status: 'failed' })
  })

  it('runs job-wide answers in the main checkout under a per-automation claim', async () => {
    const { store, deps, group } = setup('gone')
    await dispatchToAgent(deps, { ...group, worktreePath: null })
    expect(vi.mocked(deps.open).mock.calls[0][0].worktree).toEqual({ id: null, path: '/main' })
    expect(store.queue.claim('/main#ci', 'someone-else', NOW + 1, NOW)).toBe(false)
  })
})
