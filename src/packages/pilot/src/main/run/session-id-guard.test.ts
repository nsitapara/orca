import { describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { isSessionId } from '../../shared/session-id'
import { PilotStore } from '../store/store'
import { launchAgentStep, type AgentStepDeps } from './agent-step'
import { resumeCommand } from './resume-session'
import { sessionPatch } from './session-pin'
import { agentArgv, planSession } from './step-launch-plan'

// A session id comes back from an agent's hooks (agent-reported) and later becomes `--resume <id>` or
// `codex resume <id>`: one shaped like a flag or carrying a space would inject arguments. Only the UUID shape
// Claude and Codex both produce counts, checked before it is stored and again before any argv is built.
const CLAUDE_ID = '3f2b9c1e-7a4d-4e8f-9b0c-1d2e3f4a5b6c'
const CODEX_ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b'
const BAD = [
  '--dangerously-skip-permissions',
  'x --foo',
  '-c',
  '3f2b9c1e-7a4d-4e8f-9b0c-1d2e3f4a5b6c --yolo',
  '../../etc/passwd',
  ''
]

describe('session ids', () => {
  it.each([CLAUDE_ID, CODEX_ID, CLAUDE_ID.toUpperCase()])('accepts the UUID %s', (id) => {
    expect(isSessionId(id)).toBe(true)
  })

  it.each(BAD)('refuses %j', (id) => {
    expect(isSessionId(id)).toBe(false)
  })

  it.each(BAD)("never records a hook's id %j on a step", (id) => {
    expect(
      sessionPatch({ sessionId: null, transcriptPath: null }, { id, transcriptPath: null })
    ).toBeNull()
  })

  it.each(BAD)('never stores %j as a per_worktree session', (id) => {
    const store = PilotStore.open(':memory:')
    expect(() => store.sessions.set('a', '/wt', 'codex', id, 1)).toThrow('not a session id')
    expect(store.sessions.get('a', '/wt', 'codex')).toBeNull()
  })

  it.each(BAD.filter(Boolean))('never puts %j in a resume, fork or pinned argv', (id) => {
    for (const session of [
      { kind: 'resume' as const, sessionId: id },
      { kind: 'fork' as const, sessionId: id },
      { kind: 'fresh' as const, sessionId: id }
    ]) {
      expect(() => agentArgv('claude', session, [])).toThrow('not a session id')
      expect(() => agentArgv('codex', session, [])).toThrow('not a session id')
    }
  })

  it.each(BAD.filter(Boolean))('never makes a Resume command of %j', (id) => {
    expect(resumeCommand('claude', id)).toBeNull()
    expect(resumeCommand('codex', id)).toBeNull()
  })

  it('makes a Resume command of a UUID', () => {
    expect(resumeCommand('codex', CODEX_ID)).toBe(`codex resume ${CODEX_ID}`)
  })

  it('starts fresh instead of resuming a stored per_worktree id of the wrong shape', () => {
    const step = testStep({ name: 'pass', agent: 'codex', session: { kind: 'per_worktree' } })
    const plan = planSession({
      step,
      agent: 'codex',
      priorSteps: [],
      worktreeSession: '--dangerously-bypass-approvals-and-sandbox',
      newId: () => CLAUDE_ID
    })
    expect(plan).toEqual({ kind: 'fresh', sessionId: null })
  })

  it('fails a continue step whose earlier step holds an id of the wrong shape', () => {
    const plan = planSession({
      step: testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } }),
      agent: 'claude',
      priorSteps: [{ name: 'review', agent: 'claude', sessionId: 'x --foo' }] as never,
      worktreeSession: null,
      newId: () => CLAUDE_ID
    })
    expect(plan).toMatchObject({ kind: 'missing' })
  })

  it('launches a per_worktree step fresh, and forgets the id, when the stored one is flag-shaped', async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', agent: 'codex', session: { kind: 'per_worktree' } })]
    })
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'run-1',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    // As an older Pilot (or a hand edit) could have left it, past the store's own check.
    ;(
      store.sessions as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } }
    ).db
      .prepare(
        'INSERT INTO agent_sessions (automation_id, worktree_path, agent, session_id, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('cycles', '/wt/a', 'codex', '--dangerously-bypass-approvals-and-sandbox', 1)
    const launchTerminal = vi.fn(async () => ({ handle: 'term_1', paneKey: 'tab:leaf' }))
    const deps: AgentStepDeps = {
      launchTerminal,
      modeText: async () => null,
      newSessionId: () => CLAUDE_ID,
      now: () => 7,
      transcriptExists: async () => true
    }
    await launchAgentStep(
      store,
      {
        runId: 'run-1',
        definition: def,
        stepIdx: 0,
        itemKey: 'wt:a',
        label: 'a',
        fields: {},
        workspace: {
          kind: 'item_worktree',
          path: '/wt/a',
          worktreeId: 'r::/wt/a',
          selector: 'id:r::/wt/a',
          created: false
        }
      },
      deps
    )
    const argv = (
      launchTerminal.mock.calls[0] as unknown as [string, { pilot: { argv: string[] } }]
    )[1].pilot.argv
    expect(argv).toEqual([])
    expect(store.sessions.get('cycles', '/wt/a', 'codex')).toBeNull()
  })
})
