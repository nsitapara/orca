import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { loadDefinitions } from '../definitions/loader'
import { PilotStore } from '../store/store'
import { activityList, runDetail } from './run-views'

const URL = 'https://gitlab.example/mr/1'

function context() {
  const store = PilotStore.open(':memory:')
  const one = testDefinition({
    id: 'one',
    name: '13 · Job',
    job: {
      id: '13',
      name: 'Job',
      stage: 1,
      label: 'One',
      feeds: [
        {
          to: 'two',
          pass: { id: 'ticket' },
          run: 'now',
          when: 'success',
          caption: null,
          trust: 'shell'
        }
      ]
    },
    steps: [
      testStep({ name: 'ticket', agent: 'shell', run: './t.sh', prompt: null, outputs: ['ticket'] })
    ]
  })
  const two = testDefinition({
    id: 'two',
    name: '13 · Job',
    job: { id: '13', name: null, stage: 2, label: 'Two', feeds: [] }
  })
  const loaded = { ...loadDefinitions([]), definitions: [one, two] }
  return {
    store,
    ctx: {
      processKind: 'main' as const,
      store,
      dirs: [],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: { nextTickAt: () => null } as never,
      actions: { entries: () => [], get: () => null },
      dispatcher: null,
      schedulerOn: true
    }
  }
}

function decision(key: string): ItemDecision {
  return {
    key,
    label: key,
    verdict: 'started',
    reason: '',
    checks: [],
    onceKey: key,
    fields: { 'mr.web_url': URL }
  }
}

describe('activityList', () => {
  it('returns live runs of any age, the ticks since a time, and the runs no tick started', () => {
    const { ctx, store } = context()
    const old = store.startTick('one', 10)
    store.finishTick(old, 'ok', null, { started: 1 }, 11)
    store.runs.create({
      id: 'asking',
      automationId: 'one',
      tickId: old,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 10,
      status: 'needs_you'
    })
    store.recordDecisions(old, [decision('!1')], new Map([['!1', 'asking']]))
    const recent = store.startTick('two', 500)
    store.finishTick(recent, 'ok', null, { started: 1 }, 501)
    store.runs.create({
      id: 'fixed',
      automationId: 'two',
      tickId: recent,
      itemKey: 'WEB-1',
      itemLabel: 'WEB-1',
      worktreePath: null,
      startedAt: 500,
      status: 'done'
    })
    store.runs.create({
      id: 'answer',
      automationId: 'one',
      tickId: null,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 600,
      trigger: 'answer',
      parentRunId: 'asking',
      status: 'done'
    })

    const all = activityList(ctx, { since: 100, limit: 50, skipQuiet: false })
    expect(all.live.map((r) => [r.id, r.fields['mr.web_url']])).toEqual([['asking', URL]])
    expect(all.ticks.map((t) => [t.id, t.runs.map((r) => r.id)])).toEqual([[recent, ['fixed']]])
    expect(all.loose.map((r) => r.id)).toEqual(['answer'])
    expect(activityList(ctx, { automationIds: ['two'], limit: 50, skipQuiet: false }).live).toEqual(
      []
    )
    store.close()
  })
})

describe('runDetail', () => {
  it('returns one run with its tick item, cards, handovers, answer runs and chain', () => {
    const { ctx, store } = context()
    const tick = store.startTick('one', 1)
    store.finishTick(tick, 'ok', null, { started: 1 }, 2)
    store.runs.create({
      id: 'r1',
      automationId: 'one',
      tickId: tick,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1,
      status: 'done'
    })
    store.recordDecisions(tick, [decision('!1')], new Map([['!1', 'r1']]))
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 'ticket',
      agent: 'shell',
      skill: null,
      startedAt: 1,
      kind: 'shell'
    })
    store.handovers.add({
      senderId: 'one',
      senderRunId: 'r1',
      receiverId: 'two',
      itemIds: ['WEB-1'],
      at: 3
    })
    store.runs.create({
      id: 'r2',
      automationId: 'one',
      tickId: null,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 4,
      trigger: 'answer',
      parentRunId: 'r1'
    })

    const d = runDetail(ctx, 'r1')
    expect(d).toMatchObject({ automationName: '13 · Job', tickItem: { itemKey: '!1' } })
    expect(d.run.fields['mr.web_url']).toBe(URL)
    expect(d.chain.map((p) => p.key)).toContain('handover:two')
    expect(d.run.steps.map((s) => s.name)).toEqual(['ticket'])
    expect(d.handovers.map((h) => h.itemId)).toEqual(['WEB-1'])
    expect(d.answerRuns.map((r) => r.id)).toEqual(['r2'])
    expect(() => runDetail(ctx, 'nope')).toThrow('No run "nope"')
    store.close()
  })

  it('still returns a run whose automation is no longer loaded, with no chain and no tick item', () => {
    const { ctx, store } = context()
    store.runs.create({
      id: 'gone',
      automationId: 'removed',
      tickId: 999,
      itemKey: 'x',
      itemLabel: 'x',
      worktreePath: null,
      startedAt: 1,
      status: 'done'
    })
    expect(runDetail(ctx, 'gone')).toMatchObject({
      automationName: 'removed',
      chain: [],
      tickItem: null,
      trigger: null
    })
    store.close()
  })
})
