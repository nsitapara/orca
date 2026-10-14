import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { EnvMode } from '../../shared/api-types-env'
import { PilotStore } from '../store/store'
import type { AgentStepDeps, AgentStepRequest } from './agent-step'
import {
  rememberLearnedSession,
  rememberWorktreeSession,
  worktreeSessionToResume
} from './worktree-session'

const SID = '00000000-0000-4000-8000-00000000000c'
const def = testDefinition({
  id: 'cycles',
  steps: [testStep({ name: 'pass', agent: 'codex', session: { kind: 'per_worktree' } })]
})
const deps = { transcriptExists: async () => true } as unknown as AgentStepDeps
const request = (disposable: boolean): AgentStepRequest =>
  ({
    runId: 'run-1',
    definition: def,
    stepIdx: 0,
    workspace: { kind: 'env', path: '/wt/a', disposable }
  }) as unknown as AgentStepRequest

function runIn(mode: EnvMode | null): PilotStore {
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
  if (mode) {
    store.runs.envs.begin('run-1', '/home', { args: [], preparer: { pid: 1, identity: null } })
    store.runs.envs.ready('run-1', {
      mode,
      reason: '',
      path: '/wt/a',
      home: '/home',
      worktreeId: 'id',
      sha: 'abc',
      envFile: null,
      vars: {},
      stack: null
    })
  }
  return store
}

describe('a throwaway keeps no per-worktree session', () => {
  it.each([
    ['disposable', true, null],
    ['not disposable', false, SID]
  ])('%s: remembers, then resumes only if not', async (_n, disposable, resumed) => {
    const store = runIn(null)
    rememberWorktreeSession(store, request(disposable), 'codex', SID, 5)
    expect(store.sessions.get('cycles', '/wt/a', 'codex')?.sessionId ?? null).toBe(resumed)
    store.sessions.set('cycles', '/wt/a', 'codex', SID, 5)
    expect(await worktreeSessionToResume(store, request(disposable), 'codex', deps)).toBe(resumed)
  })

  it.each<[EnvMode | null, string | null]>([
    [null, SID],
    ['in_place', SID],
    ['kept', SID],
    ['throwaway', null]
  ])('a learned session of a %s run is stored: %s', (mode, stored) => {
    const store = runIn(mode)
    rememberLearnedSession(store, () => def, { runId: 'run-1', idx: 0, agent: 'codex' }, SID, 5)
    expect(store.sessions.get('cycles', '/wt/a', 'codex')?.sessionId ?? null).toBe(stored)
  })
})
