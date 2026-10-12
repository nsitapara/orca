import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxItemRow } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import { dispatchToAgent, type AgentDispatchDeps } from './answer-run'
import { PromptNotSentError } from '../run/agent-step'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
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
    current: (item) => item,
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
    // A resumed session gets the mode's rules too (never push yourself), as a pointer to the mode file.
    expect(vi.mocked(deps.send).mock.calls[0][1]).toMatch(
      /^Apply these answers as ~\/\.agents\/skills\/fix-gitlab-ci\/modes\/answers\.md says\. Answers to/
    )
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
    expect(vi.mocked(deps.open).mock.calls[0][0].prompt).toMatch(
      /^Apply these answers as ~\/\.agents\/skills\/fix-gitlab-ci\/modes\/answers\.md says\. Answers to/
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
      // Unreadable is busy (24a): a hold that doesn't count toward the dispatcher's tries.
      {
        holdReason: 'worktree_busy',
        holdDetail: 'the asking tab could not be read: runtime not ready'
      }
    ]
  ])('holds on %s', async (_name, over, held) => {
    const { deps, group } = setup('gone', over)
    expect(await dispatchToAgent(deps, group)).toEqual({ kind: 'held', hold: held })
  })

  it('reads a quota that fails as unknown, which lets the answers go (quota rules)', async () => {
    const { deps, group } = setup('gone', {
      quota: () => Promise.reject(new Error('usage endpoint down'))
    })
    expect(await dispatchToAgent(deps, group)).toMatchObject({ kind: 'dispatched' })
  })

  // Fix round 1 (req 9): the H10 look, the quota read and the main checkout are all awaited.
  it('leaves out a card that moved on during the awaits, and sends nothing when none is left', async () => {
    const moved = new Set<string>()
    const { store, deps, group } = setup('gone', {
      quota: async () => {
        moved.add('in_b')
        return { weekly: 1, session: 1 }
      },
      current: (item) => (moved.has(item.id) ? null : item)
    })
    const other = { ...group.answers[0].item, id: 'in_b', title: 'Retry once?' } as InboxItemRow
    const two = {
      ...group,
      answers: [...group.answers, { item: other, revise: false, needsAgent: null }]
    }
    await dispatchToAgent(deps, two)
    const prompt = vi.mocked(deps.open).mock.calls[0][0].prompt
    expect(prompt).toContain('[in_a]')
    expect(prompt).not.toContain('[in_b]')
    moved.add('in_a')
    vi.mocked(deps.open).mockClear()
    expect(await dispatchToAgent(deps, two)).toEqual({ kind: 'nothing' })
    expect(deps.open).not.toHaveBeenCalled()
    expect(store.runs.get(`${RUN_ID}-2`)).toBeNull()
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

  it('fails the answer run and retries when the asking tab refused the answers untyped', async () => {
    const { store, deps, group } = setup('free', {
      send: vi.fn().mockRejectedValue(new PromptNotSentError('terminal term-1 has no idle agent'))
    })
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'held',
      hold: { holdReason: 'retry', holdDetail: 'terminal term-1 has no idle agent' }
    })
    expect(store.runs.get(RUN_ID)).toMatchObject({ status: 'failed' })
  })

  // Fix round 1: once the answers may be with an agent, nothing sends them again on its own.
  it('keeps the run going in the asking tab when the answers were typed but no turn was seen', async () => {
    const { store, deps, group } = setup('free', {
      send: vi.fn().mockRejectedValue(new Error("the agent didn't start a turn on the prompt"))
    })
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'dispatched',
      runId: RUN_ID,
      route: 'resume',
      sessionId: 'sess-1'
    })
    expect(store.runs.get(RUN_ID)?.status).toBe('running')
    expect(store.runs.steps(RUN_ID)[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term-1',
      paneKey: 'tab:leaf'
    })
    expect(store.events.forRun(RUN_ID).map((e) => e.kind)).toEqual([
      'answer_run',
      'answer_send_unconfirmed'
    ])
  })

  it.each<[string, Partial<AgentDispatchDeps>, string]>([
    [
      'a tab Pilot opened has no pane to follow',
      {
        open: vi
          .fn()
          .mockRejectedValue(
            new UnrecordedLaunchError('term-9', 'the runtime returned no pane to watch')
          )
      },
      'terminal term-9: the runtime returned no pane to watch'
    ],
    [
      'the run was closed while its agent started',
      {},
      'terminal term-2: the answer run was closed before its agent started'
    ]
  ])('hands the cards back, sending nothing again, when %s', async (name, over, detail) => {
    const { store, deps, group } = setup('gone', over)
    if (name.startsWith('the run was closed')) {
      // As the stale-start sweep would, during a slow launch.
      vi.mocked(deps.open).mockImplementationOnce(async (req) => {
        store.runs.updateStep(req.runId, 0, { status: 'failed', finishedAt: NOW })
        return { terminalHandle: 'term-2', paneKey: 'tab2:leaf', sessionId: null }
      })
    }
    expect(await dispatchToAgent(deps, group)).toEqual({
      kind: 'unfollowed',
      runId: RUN_ID,
      detail
    })
    expect(store.runs.get(RUN_ID)).toMatchObject({ status: 'failed' })
  })

  it('gives a retried dispatch in the same minute its own run', async () => {
    const { store, deps, group } = setup('gone', {
      open: vi.fn().mockRejectedValue(new Error('worktree is gone'))
    })
    await dispatchToAgent(deps, group)
    await dispatchToAgent(deps, group)
    expect(store.runs.get(`${RUN_ID}-2`)).toMatchObject({ trigger: 'answer', status: 'failed' })
  })

  it("holds job-wide answers while this automation's last answer run still works in the main checkout", async () => {
    const { store, deps, group } = setup('gone')
    store.runs.create({
      id: 'ans-0',
      automationId: 'ci',
      tickId: null,
      itemKey: 'repo:web-platform',
      itemLabel: 'web-platform',
      worktreePath: '/main',
      startedAt: 1,
      trigger: 'answer'
    })
    expect(await dispatchToAgent(deps, { ...group, worktreePath: null })).toEqual({
      kind: 'held',
      hold: { holdReason: 'worktree_busy', holdDetail: 'answer run ans-0 is still working there' }
    })
    expect(deps.open).not.toHaveBeenCalled()
  })

  it('runs job-wide answers in the main checkout under a per-automation claim', async () => {
    const { store, deps, group } = setup('gone')
    await dispatchToAgent(deps, { ...group, worktreePath: null })
    expect(vi.mocked(deps.open).mock.calls[0][0].worktree).toEqual({ id: null, path: '/main' })
    expect(store.queue.claim('/main#ci', 'someone-else', NOW + 1, NOW)).toBe(false)
  })
})
