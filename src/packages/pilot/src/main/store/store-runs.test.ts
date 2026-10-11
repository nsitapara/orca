import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import type { NewRun } from './store-runs'

const run = (id: string, extra: Partial<NewRun> = {}): NewRun => ({
  id,
  automationId: 'a',
  tickId: null,
  itemKey: id,
  itemLabel: id,
  worktreePath: '/wt',
  startedAt: 1,
  ...extra
})

describe('RunStore v2', () => {
  it('creates a run with the v2 defaults', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('r1'))
    expect(store.runs.get('r1')).toMatchObject({
      status: 'running',
      worktreeId: null,
      trigger: 'schedule',
      parentRunId: null,
      imported: false
    })
  })

  it('creates a run with the status, trigger, parent and worktree id it is given', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(
      run('r2', {
        status: 'asking',
        trigger: 'answer',
        parentRunId: 'r1',
        worktreeId: 'repo::/wt',
        imported: true
      })
    )
    expect(store.runs.get('r2')).toMatchObject({
      status: 'asking',
      trigger: 'answer',
      parentRunId: 'r1',
      worktreeId: 'repo::/wt',
      imported: true
    })
  })

  it('creates agent steps that start now by default, and pending shell steps when asked', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('r1'))
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 'review',
      agent: 'codex',
      skill: 'review-branch',
      startedAt: 5
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 1,
      name: 'cleanup',
      agent: 'shell',
      skill: null,
      startedAt: null,
      kind: 'shell',
      whenExpr: '{steps.review.changed} == true',
      status: 'pending'
    })
    expect(store.runs.steps('r1')).toMatchObject([
      {
        name: 'review',
        kind: 'agent',
        status: 'starting',
        startedAt: 5,
        mode: null,
        whenExpr: null,
        outputs: {},
        exitCode: null,
        sessionPinned: false
      },
      {
        name: 'cleanup',
        kind: 'shell',
        status: 'pending',
        startedAt: null,
        whenExpr: '{steps.review.changed} == true'
      }
    ])
  })

  it('stores step outputs, exit code, output tail, model and the pinned-session flag', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('r1'))
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    store.runs.updateStep('r1', 0, {
      status: 'skipped',
      outputs: { changed: true, findings: 2 },
      exitCode: 3,
      outputTail: 'nothing to do\n',
      model: 'claude-opus-4',
      sessionPinned: true
    })
    expect(store.runs.steps('r1')[0]).toMatchObject({
      status: 'skipped',
      outputs: { changed: true, findings: 2 },
      exitCode: 3,
      outputTail: 'nothing to do\n',
      model: 'claude-opus-4',
      sessionPinned: true
    })
  })

  it('moves a run to the worktree it got', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('r1', { worktreePath: null }))
    store.runs.update('r1', { worktreePath: '/wt/new', worktreeId: 'repo::/wt/new' })
    expect(store.runs.get('r1')).toMatchObject({
      worktreePath: '/wt/new',
      worktreeId: 'repo::/wt/new'
    })
  })

  it('finds the running runs of every automation in a worktree', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('mine', { automationId: 'a' }))
    store.runs.create(run('theirs', { automationId: 'b' }))
    store.runs.create(run('finished', { automationId: 'b' }))
    store.runs.update('finished', { status: 'done' })
    store.runs.create(run('elsewhere', { worktreePath: '/other' }))
    expect(store.runs.runningInWorktree('/wt').map((r) => r.id)).toEqual(['mine', 'theirs'])
  })

  it.each([
    ['running', 1],
    ['needs_you', 0],
    ['asking', 0],
    ['done', 0],
    ['failed', 0],
    ['timed_out', 0],
    ['cancelled', 0]
  ] as const)('counts a %s run against at_once as %i (running runs only, H2)', (status, count) => {
    const store = PilotStore.open(':memory:')
    store.runs.create(run('r1', { status }))
    store.runs.create(run('other', { automationId: 'b' }))
    expect(store.runs.runningCount('a')).toBe(count)
  })
})
