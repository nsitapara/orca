import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import type { EnvReady } from './store-envs'

const READY: EnvReady = {
  mode: 'throwaway',
  reason: 'uncommitted changes',
  path: '/agents/r/agents-r1',
  home: '/wt/a',
  worktreeId: 'repo::/agents/r/agents-r1',
  sha: 'abc',
  envFile: '/state/envs/r1/env.sh',
  vars: { API_URL: 'http://localhost:8123' },
  stack: {
    kind: 'backend',
    project: 'agents-r1',
    urls: { api: 'http://localhost:8123' },
    log: null
  }
}

function setup() {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt/a',
    startedAt: 1
  })
  store.runs.envs.begin('r1', '/wt/a', {
    args: ['env', 'create'],
    preparer: { pid: 7, identity: null }
  })
  return store
}

describe('EnvStore', () => {
  it('a run that isn’t an env run reads env null and homePath null', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'r0',
      automationId: 'ci',
      tickId: null,
      itemKey: 'k',
      itemLabel: 'l',
      worktreePath: '/wt',
      startedAt: 1
    })
    expect(store.runs.get('r0')).toMatchObject({ homePath: null, env: null })
  })

  it('preparing, then ready: the run works in the env folder, its home stays the item worktree', () => {
    const store = setup()
    expect(store.runs.get('r1')?.env).toMatchObject({ state: 'preparing', mode: null })
    expect(store.runs.envs.ready('r1', READY)).toBe(true)
    expect(store.runs.get('r1')).toMatchObject({
      worktreePath: '/agents/r/agents-r1',
      worktreeId: 'repo::/agents/r/agents-r1',
      homePath: '/wt/a',
      env: {
        state: 'ready',
        mode: 'throwaway',
        reason: 'uncommitted changes',
        vars: READY.vars,
        stack: READY.stack,
        deleteAttempts: 0
      }
    })
    expect(store.runs.envs.json('r1').preparer).toEqual({ pid: 7, identity: null })
  })

  it('refuses ready once the run ended (a cancel during create)', () => {
    const store = setup()
    store.runs.update('r1', { status: 'cancelled', finishedAt: 5 })
    expect(store.runs.envs.ready('r1', READY)).toBe(false)
    expect(store.runs.get('r1')?.env?.state).toBe('preparing')
  })

  it.each([
    [1, 61_000],
    [2, 121_000],
    [3, 241_000],
    [7, 3_601_000],
    [9, 3_601_000]
  ])('a failed delete, try %i, waits until %i', (tries, retryAt) => {
    const store = setup()
    store.runs.envs.ready('r1', READY)
    store.runs.update('r1', { status: 'done', finishedAt: 2 })
    let attempts = 0
    for (let i = 0; i < tries; i += 1) {
      attempts = store.runs.envs.deleteFailed('r1', 'docker said no', 1000)
    }
    expect(attempts).toBe(tries)
    expect(store.runs.get('r1')?.env).toMatchObject({
      deleteError: 'docker said no',
      deleteAttempts: tries,
      removedAt: null
    })
    expect(store.runs.envs.dueForTeardown(retryAt - 1).map((r) => r.id)).toEqual([])
    expect(store.runs.envs.dueForTeardown(retryAt).map((r) => r.id)).toEqual(['r1'])
  })

  it.each([
    ['running', 'ready', false],
    ['done', 'ready', true],
    ['cancelled', 'deferred', true],
    ['failed', 'failed', true],
    ['failed', 'preparing', false]
  ] as const)('a %s run with a %s env is due for teardown: %s', (status, state, due) => {
    const store = setup()
    if (state === 'ready') {
      store.runs.envs.ready('r1', READY)
    }
    if (state === 'deferred' || state === 'failed') {
      store.runs.envs.settle('r1', state, 'why')
    }
    store.runs.update('r1', { status, finishedAt: 2 })
    expect(store.runs.envs.dueForTeardown(10).length > 0).toBe(due)
  })

  it('a not_yet delete waits 15 s and counts no try; a refused one is stuck and never due', () => {
    const store = setup()
    store.runs.envs.ready('r1', READY)
    store.runs.update('r1', { status: 'done', finishedAt: 2 })
    store.runs.envs.deleteWaits('r1', 'create for r1 is still running', 1000)
    expect(store.runs.get('r1')?.env).toMatchObject({
      deleteError: 'create for r1 is still running',
      deleteAttempts: 0,
      removedAt: null
    })
    expect(store.runs.envs.dueForTeardown(15_999)).toEqual([])
    expect(store.runs.envs.dueForTeardown(16_000).map((r) => r.id)).toEqual(['r1'])
    store.runs.envs.deleteRefused('r1', 'invalid run name "r1/.."')
    expect(store.runs.get('r1')?.env).toMatchObject({
      state: 'stuck',
      deleteError: 'invalid run name "r1/.."',
      removedAt: null
    })
    expect(store.runs.envs.dueForTeardown(Number.MAX_SAFE_INTEGER)).toEqual([])
  })

  it('a failed create is still due for delete (P12); removed, it is not, until the sweep reopens it', () => {
    const store = setup()
    store.runs.update('r1', { status: 'done', finishedAt: 2 })
    store.runs.envs.settle('r1', 'failed', 'bad flags')
    expect(store.runs.envs.dueForTeardown(10).map((r) => r.id)).toEqual(['r1'])
    store.runs.envs.removed('r1', 11)
    expect(store.runs.envs.dueForTeardown(Number.MAX_SAFE_INTEGER)).toEqual([])
    expect(store.runs.get('r1')?.env).toMatchObject({
      state: 'removed',
      removedAt: 11,
      deleteError: null
    })
  })

  it("a failed create's log tail is kept beside what begin recorded, after its env is removed", () => {
    const store = setup()
    store.runs.envs.settle('r1', 'failed', 'the stack exited', ['vite: port 3017 is in use'])
    store.runs.envs.removed('r1', 11)
    expect(store.runs.envs.json('r1')).toMatchObject({
      args: ['env', 'create'],
      output: ['vite: port 3017 is in use']
    })
  })

  // The sweep found pilotcli still has it: due again at once, in the state it had before it was removed, its backoff
  // starting over.
  it.each([
    ['a failed create', false, 'failed'],
    ['a ready env', true, 'ready']
  ] as const)('%s reopened is due for delete again', (_name, made, state) => {
    const store = setup()
    if (made) {
      store.runs.envs.ready('r1', READY)
    } else {
      store.runs.envs.settle('r1', 'failed', 'bad flags')
    }
    store.runs.update('r1', { status: 'done', finishedAt: 2 })
    store.runs.envs.deleteFailed('r1', 'busy', 10)
    store.runs.envs.removed('r1', 11)
    store.runs.envs.reopen('r1')
    expect(store.runs.get('r1')?.env).toMatchObject({ state, removedAt: null, deleteAttempts: 0 })
    expect(store.runs.envs.dueForTeardown(12).map((r) => r.id)).toEqual(['r1'])
  })

  it('knows the throwaway folders it works in now, however the path is spelled', () => {
    const store = setup()
    store.runs.envs.ready('r1', READY)
    expect(store.runs.envs.isThrowawayFolder('/agents/r/agents-r1/')).toBe(true)
    store.runs.envs.removed('r1', 9)
    expect(store.runs.envs.isThrowawayFolder('/agents/r/agents-r1')).toBe(false)
  })

  it('the timeline and the day’s cost follow the home path, not the folder', () => {
    const store = setup()
    store.runs.envs.ready('r1', READY)
    expect(store.runs.forWorktree(['/wt/a'], 0).map((r) => r.id)).toEqual(['r1'])
    expect(store.runs.forWorktree(['/agents/r/agents-r1'], 0)).toEqual([])
  })

  it('a deferred env that is then marked removed still reads as deferred, with removedAt set', () => {
    const store = setup()
    store.runs.envs.settle('r1', 'deferred', 'not yet')
    store.runs.update('r1', { status: 'done', finishedAt: 2 })
    store.runs.envs.removed('r1', 12)
    expect(store.runs.get('r1')?.env).toMatchObject({
      state: 'deferred',
      reason: 'not yet',
      removedAt: 12
    })
    expect(store.runs.envs.dueForTeardown(Number.MAX_SAFE_INTEGER)).toEqual([])
  })

  it('a hold_home claim counts only while its step runs, released or not', () => {
    const store = setup()
    store.runs.envs.ready('r1', READY)
    store.runs.createStep({
      runId: 'r1',
      idx: 2,
      name: 'merge_back',
      agent: 'shell',
      skill: null,
      startedAt: 5,
      kind: 'shell',
      status: 'running'
    })
    expect(store.runs.runningInWorktree('/wt/a')).toEqual([])
    store.runs.envs.holdHome('r1', 2)
    expect(store.runs.runningInWorktree('/wt/a').map((r) => r.id)).toEqual(['r1'])
    expect([...store.runs.runningWorktreePaths()]).toContain('/wt/a')
    // The step ends without a release (a crash's orphan sweep): the claim lapses with it.
    store.runs.updateStep('r1', 2, { status: 'failed', finishedAt: 6 })
    expect(store.runs.runningInWorktree('/wt/a')).toEqual([])
    expect([...store.runs.runningWorktreePaths()]).not.toContain('/wt/a')
  })
})
