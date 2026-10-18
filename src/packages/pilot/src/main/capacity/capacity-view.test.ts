import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { PilotStore } from '../store/store'
import { UNMEASURED_JOB_BYTES } from '../../shared/capacity/limit-suggestion'
import { capacityView } from './capacity-view'

const GIB = 1024 ** 3

describe('capacityView', () => {
  it('lists running runs with their memory, the queue in line order, and suggests from the heaviest job', () => {
    const store = PilotStore.open(
      join(mkdtempSync(join(tmpdir(), 'pilot-capacity-view-')), 'db.sqlite')
    )
    const review = testDefinition({ id: 'review', name: '03 Review and fix' })
    const ci = testDefinition({ id: 'ci', name: '05 Fix failed CI' })
    const pull = testDefinition({
      id: 'pull',
      name: '01 Pull dev',
      steps: [testStep({ agent: 'shell', run: 'git pull', prompt: null })]
    })
    const run = (id: string, automationId: string, startedAt: number) =>
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: id,
        itemLabel: `!${id}`,
        worktreePath: null,
        startedAt
      })
    run('old-review', 'review', 1)
    store.capacity.recordPeak('old-review', 3 * GIB)
    store.runs.update('old-review', { status: 'done', finishedAt: 2 })
    run('r1', 'review', 10)
    run('p1', 'pull', 11)
    run('p0', 'pull', 3)
    store.runs.update('p0', { status: 'done', finishedAt: 4 })
    store.capacity.recordPeak('r1', 2 * GIB)
    store.capacity.setRunLimit(2, 0)
    store.capacity.enqueue({
      automationId: 'ci',
      itemKey: 'mr:9',
      itemLabel: '!9',
      queuedAt: 5,
      byHand: true,
      dueAt: 5,
      holdCode: 'capacity',
      holdDetail: 'Waiting for a slot',
      checkedAt: 5
    })
    store.capacity.enqueue({
      automationId: 'gone',
      itemKey: 'x',
      itemLabel: 'x',
      queuedAt: 1,
      byHand: false,
      dueAt: 1,
      holdCode: 'capacity',
      holdDetail: 'Waiting for a slot',
      checkedAt: 1
    })

    const view = capacityView({
      store,
      definitions: [review, ci, pull],
      memory: { runs: new Map([['r1', 1.5 * GIB]]), system: null, sampledAt: 1 },
      system: { totalBytes: 24 * GIB, availableBytes: 11 * GIB },
      now: 100
    })

    expect(view.limit).toBe(2)
    // The shell-only job's runs never wait for a slot, so they aren't listed; old-review is, with its peak and detail.
    expect(view.finished).toEqual([
      expect.objectContaining({
        id: 'old-review',
        automationName: '03 Review and fix',
        peakBytes: 3 * GIB,
        steps: [],
        inbox: [],
        fields: {}
      })
    ])
    expect(view.running).toEqual([
      {
        id: 'r1',
        automationId: 'review',
        automationName: '03 Review and fix',
        itemLabel: '!r1',
        startedAt: 10,
        idleMs: 0,
        memoryBytes: 1.5 * GIB,
        peakBytes: 2 * GIB,
        counted: true
      },
      {
        id: 'p1',
        automationId: 'pull',
        automationName: '01 Pull dev',
        itemLabel: '!p1',
        startedAt: 11,
        idleMs: 0,
        memoryBytes: null,
        peakBytes: null,
        counted: false
      }
    ])
    expect(view.queued).toEqual([
      {
        automationId: 'ci',
        automationName: '05 Fix failed CI',
        itemKey: 'mr:9',
        itemLabel: '!9',
        queuedAt: 5,
        byHand: true,
        dueAt: 5,
        holdCode: 'capacity',
        holdDetail: 'Waiting for a slot',
        checkedAt: 5
      }
    ])
    expect(view.quotaCeiling).toEqual({ weekly: 90, session: 95 })
    expect(view.heaviest).toEqual({
      automationId: 'review',
      automationName: '03 Review and fix',
      peakBytes: 3 * GIB,
      measured: true
    })
    // (11 free + 1.5 held by running jobs - 4 headroom) / 3 for the heaviest job = 2.8, so 2.
    expect(view.suggestion).toEqual({
      limit: 2,
      budgetBytes: 8.5 * GIB,
      perJobBytes: 3 * GIB,
      measured: true
    })
  })

  it('budgets an enabled job never measured as unmeasured, so a light measured job cannot raise the suggestion', () => {
    const store = PilotStore.open(
      join(mkdtempSync(join(tmpdir(), 'pilot-capacity-view-')), 'db.sqlite')
    )
    const light = testDefinition({ id: 'light', name: '14 Prepare context' })
    const heavy = testDefinition({ id: 'heavy', name: '04 Test UIs' })
    const off = testDefinition({ id: 'off', name: 'M01 Start tickets', enabled: false })
    store.runs.create({
      id: 'l1',
      automationId: 'light',
      tickId: null,
      itemKey: 'k',
      itemLabel: 'k',
      worktreePath: null,
      startedAt: 1
    })
    store.capacity.recordPeak('l1', 0.4 * GIB)
    const view = (defs: (typeof light)[]) =>
      capacityView({
        store,
        definitions: defs,
        memory: null,
        system: { totalBytes: 24 * GIB, availableBytes: 14 * GIB },
        now: 100
      })
    expect(view([light, heavy, off]).heaviest).toEqual({
      automationId: 'heavy',
      automationName: '04 Test UIs',
      peakBytes: UNMEASURED_JOB_BYTES,
      measured: false
    })
    expect(view([light, heavy, off]).suggestion).toMatchObject({ limit: 4, measured: false })
    // A turned-off job that never ran is left out.
    expect(view([light, off]).heaviest).toMatchObject({ automationId: 'light', measured: true })
  })

  it('lists the keys given up on this week, with the retry limit, and names the failed key a finished run holds', () => {
    const store = PilotStore.open(':memory:')
    const review = testDefinition({ id: 'review', name: '03 Review and fix' })
    const asks = testDefinition({ id: 'asks', name: '12 Answers', start: 'ask_first' })
    const DAY = 24 * 60 * 60_000
    const now = 30 * DAY
    const fail = (id: string, automationId: string, key: string, times: number, at: number) => {
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: `mr:${key}`,
        itemLabel: `!${key}`,
        worktreePath: null,
        startedAt: at
      })
      store.runs.update(id, { status: 'failed', outcome: 'agent exited', finishedAt: at })
      store.markHandled(automationId, key, id, at)
      for (let n = 0; n < times; n += 1) {
        store.setHandledStatus(automationId, id, 'failed', at)
      }
    }
    fail('gave-up', 'review', '1', 3, now - DAY)
    fail('retrying', 'review', '2', 1, now - DAY)
    fail('last-week', 'review', '3', 3, now - 8 * DAY)
    fail('asked', 'asks', '4', 3, now - DAY)
    store.capacity.setRetryLimit(2, 0)
    const view = capacityView({
      store,
      definitions: [review, asks],
      memory: null,
      system: { totalBytes: 24 * GIB, availableBytes: 14 * GIB },
      now
    })
    expect(view.retryLimit).toBe(2)
    expect(view.gaveUp).toEqual([
      {
        automationId: 'review',
        automationName: '03 Review and fix',
        onceKey: '1',
        itemLabel: '!1',
        failures: 3,
        failedAt: now - DAY,
        outcome: 'agent exited'
      }
    ])
    // Retry frees an ask-first job's key too: its next tick asks again.
    expect(view.finished.map((r) => [r.id, r.onceKey])).toEqual([
      ['retrying', '2'],
      ['gave-up', '1'],
      ['asked', '4'],
      ['last-week', '3']
    ])
  })
})
