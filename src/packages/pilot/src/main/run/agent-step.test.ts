import { describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import { launchAgentStep, type AgentStepDeps, type AgentStepRequest } from './agent-step'
import type { Workspace } from './workspace'

const workspace: Workspace = {
  kind: 'item_worktree',
  path: '/wt/a',
  worktreeId: 'r::/wt/a',
  selector: 'id:r::/wt/a',
  created: false
}

function setup(definition: AutomationDefinition, over: Partial<AgentStepDeps> = {}) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: definition.id,
    tickId: null,
    itemKey: 'wt:a',
    itemLabel: 'web-1-a',
    worktreePath: '/wt/a',
    startedAt: 1
  })
  let n = 0
  const launchTerminal = vi.fn(async (_selector: string, _opts: PilotAgentLaunchOptions) => {
    n += 1
    return { handle: `term_${n}`, paneKey: `tab${n}:leaf` }
  })
  const deps: AgentStepDeps = {
    launchTerminal,
    modeText: async () => null,
    newSessionId: () => 'uuid-new',
    now: () => 7,
    ...over
  }
  const request = (stepIdx: number, runId = 'run-1'): AgentStepRequest => ({
    runId,
    definition,
    stepIdx,
    itemKey: 'wt:a',
    label: 'web-1-a',
    fields: { 'worktree.branch': 'web-1-a' },
    workspace
  })
  return { store, deps, launchTerminal, request }
}
const argvOf = (call: [string, PilotAgentLaunchOptions]) => call[1].pilot.argv

describe('launchAgentStep', () => {
  it("resumes an earlier step's session for session: continue", async () => {
    const def = testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review' }),
        testStep({
          name: 'fix',
          session: { kind: 'continue', step: 'review' },
          args: ['--dangerously-skip-permissions']
        })
      ]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    await launchAgentStep(store, request(1), deps)
    expect(argvOf(launchTerminal.mock.calls[0])).toEqual(['--session-id', 'uuid-new'])
    expect(argvOf(launchTerminal.mock.calls[1])).toEqual([
      '--resume',
      'uuid-new',
      '--dangerously-skip-permissions'
    ])
    expect(store.runs.steps('run-1').map((s) => [s.name, s.status, s.sessionId])).toEqual([
      ['review', 'running', 'uuid-new'],
      ['fix', 'running', 'uuid-new']
    ])
  })

  it("fails the step without launching when the session to continue isn't there", async () => {
    const def = testDefinition({
      steps: [
        testStep({ name: 'review' }),
        testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
      ]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(
      'Step "review" hasn\'t run'
    )
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      name: 'fix',
      status: 'failed',
      error: expect.stringContaining("hasn't run")
    })
  })

  it('pins and remembers a per-worktree Claude session, then resumes it on the next run', async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', session: { kind: 'per_worktree' } })]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    expect(store.sessions.get('cycles', '/wt/a', 'claude')?.sessionId).toBe('uuid-new')
    store.runs.create({
      id: 'run-2',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'web-1-a',
      worktreePath: '/wt/a',
      startedAt: 2
    })
    await launchAgentStep(store, request(0, 'run-2'), { ...deps, newSessionId: () => 'uuid-other' })
    expect(argvOf(launchTerminal.mock.calls[1])).toEqual(['--resume', 'uuid-new'])
  })

  it("doesn't pin or store a Codex session (it is learned from its hooks)", async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', agent: 'codex', session: { kind: 'per_worktree' } })]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    expect(argvOf(launchTerminal.mock.calls[0])).toEqual([])
    expect(store.sessions.get('cycles', '/wt/a', 'codex')).toBeNull()
    expect(store.runs.steps('run-1')[0].sessionId).toBeNull()
  })

  it('launches with the step env, the mode text in a wrapped prompt, and a title naming the step', async () => {
    const def = testDefinition({
      id: 'ci',
      name: 'Fix CI',
      powers: ['commit'],
      steps: [
        testStep({
          name: 'fix',
          skill: 'fix-gitlab-ci',
          mode: 'answers',
          prompt: 'Go on {worktree.branch}.'
        }),
        testStep({ name: 'cleanup' })
      ]
    })
    const modeText = vi.fn(async () => 'Answer mode.')
    const { store, request, launchTerminal, deps } = setup(def, { modeText })
    await launchAgentStep(store, request(0), deps)
    expect(modeText).toHaveBeenCalledWith(expect.objectContaining({ name: 'fix' }), '/wt/a')
    const [selector, opts] = launchTerminal.mock.calls[0]
    expect(selector).toBe('id:r::/wt/a')
    expect(opts).toMatchObject({
      agent: 'claude',
      title: 'Fix CI · web-1-a · fix',
      prompt:
        'Started by the Pilot automation "Fix CI" (run run-1) for web-1-a.\nUse the fix-gitlab-ci skill.\n\nAnswer mode.\n\nGo on web-1-a.',
      pilot: {
        env: expect.objectContaining({
          PILOT_STEP: 'fix',
          PILOT_STEP_IDX: '0',
          PILOT_POWERS: 'commit',
          AGENT_RUN: 'run-1'
        })
      }
    })
  })

  it('fails the step with the reason when its mode text cannot be read', async () => {
    const def = testDefinition({ steps: [testStep({ mode: 'answers', skill: 'x' })] })
    const { store, request, launchTerminal, deps } = setup(def, {
      modeText: async () => {
        throw new Error('No mode "answers" in skill x')
      }
    })
    await expect(launchAgentStep(store, request(0), deps)).rejects.toThrow(
      'No mode "answers" in skill x'
    )
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'No mode "answers" in skill x'
    })
  })

  // B8: Task 9b's startRun writes step 0 as pending before the workspace exists.
  it('takes over the pending row the engine wrote instead of adding a second one', async () => {
    const def = testDefinition({ steps: [testStep({ name: 'fix' })] })
    const { store, request, deps } = setup(def)
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'fix',
      agent: 'claude',
      skill: null,
      status: 'pending',
      startedAt: null
    })
    await launchAgentStep(store, request(0), deps)
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      sessionId: 'uuid-new',
      sessionPinned: true,
      startedAt: 7
    })
  })
})

// H10: a continued or per-worktree session goes back into its terminal when that is still free.
describe('launchAgentStep into a live session terminal', () => {
  const continuing = () =>
    testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review' }),
        testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
      ]
    })

  it('sends the prompt into the live, idle terminal of the session it continues', async () => {
    const sendPrompt = vi.fn(async () => {})
    const resumeTarget = vi.fn(async () => true)
    const { store, request, launchTerminal, deps } = setup(continuing(), {
      resumeTarget,
      sendPrompt
    })
    await launchAgentStep(store, request(0), deps)
    await launchAgentStep(store, request(1), deps)
    expect(launchTerminal).toHaveBeenCalledTimes(1)
    expect(resumeTarget).toHaveBeenCalledWith('term_1', 'tab1:leaf')
    expect(sendPrompt).toHaveBeenCalledWith(
      'term_1',
      expect.stringContaining('Started by the Pilot automation')
    )
    expect(
      store.runs.steps('run-1').map((s) => [s.name, s.status, s.terminalHandle, s.sessionId])
    ).toEqual([
      ['review', 'running', 'term_1', 'uuid-new'],
      ['fix', 'running', 'term_1', 'uuid-new']
    ])
  })

  it('resumes the session in a new terminal when the old one is gone, busy or has a draft', async () => {
    const sendPrompt = vi.fn(async () => {})
    const { store, request, launchTerminal, deps } = setup(continuing(), {
      resumeTarget: async () => false,
      sendPrompt
    })
    await launchAgentStep(store, request(0), deps)
    await launchAgentStep(store, request(1), deps)
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(launchTerminal).toHaveBeenCalledTimes(2)
    expect(argvOf(launchTerminal.mock.calls[1])).toEqual(['--resume', 'uuid-new'])
  })

  it("sends a per-worktree step into the stored session's live terminal", async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', session: { kind: 'per_worktree' } })]
    })
    const sendPrompt = vi.fn(async () => {})
    const { store, request, launchTerminal, deps } = setup(def, {
      resumeTarget: async () => true,
      sendPrompt
    })
    await launchAgentStep(store, request(0), deps)
    store.runs.create({
      id: 'run-2',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'web-1-a',
      worktreePath: '/wt/a',
      startedAt: 2
    })
    await launchAgentStep(store, request(0, 'run-2'), deps)
    expect(launchTerminal).toHaveBeenCalledTimes(1)
    expect(sendPrompt).toHaveBeenCalledWith('term_1', expect.any(String))
    expect(store.runs.steps('run-2')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1',
      sessionId: 'uuid-new'
    })
  })

  it('fails the step, opening no second terminal, when the prompt cannot be sent into a terminal that looked free', async () => {
    const sendPrompt = vi.fn(async () => {
      throw new Error('someone is typing there')
    })
    const { store, request, launchTerminal, deps } = setup(continuing(), {
      resumeTarget: async () => true,
      sendPrompt
    })
    await launchAgentStep(store, request(0), deps)
    await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(
      'someone is typing there'
    )
    expect(launchTerminal).toHaveBeenCalledTimes(1)
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      name: 'fix',
      status: 'failed',
      error: 'someone is typing there'
    })
  })
})
