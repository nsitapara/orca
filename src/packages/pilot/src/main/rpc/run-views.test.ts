import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { queuedPreparation } from '../../shared/preparation'
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
    expect(all.reach).toBeNull()
    store.close()
  })

  it('stops loose runs at the oldest shown tick when the tick page is full, and says how far back it reaches', () => {
    const { ctx, store } = context()
    const loose = (id: string, startedAt: number): void =>
      store.runs.create({
        id,
        automationId: 'one',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt,
        trigger: 'import',
        status: 'done'
      })
    for (const at of [300, 400]) {
      store.finishTick(store.startTick('one', at), 'ok', null, { started: 0 }, at + 1)
    }
    loose('older', 100)
    loose('newer', 350)

    const cut = activityList(ctx, { since: 50, limit: 2, skipQuiet: false })
    expect(cut.reach).toBe(300)
    expect(cut.loose.map((r) => r.id)).toEqual(['newer'])
    const whole = activityList(ctx, { since: 50, limit: 3, skipQuiet: false })
    expect(whole.reach).toBeNull()
    expect(whole.loose.map((r) => r.id).sort()).toEqual(['newer', 'older'])
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
    expect(d.receivedFrom).toEqual([])
    expect(d.preparation).toBeNull()
    expect(() => runDetail(ctx, 'nope')).toThrow('No run "nope"')
    store.close()
  })

  it('says what a context-preparation run prepares: its card, who asked, what it gathers and which try', () => {
    const { ctx, store } = context()
    store.inbox.add({
      id: 'c1',
      automationId: 'one',
      runId: 'asker',
      stepIdx: 0,
      itemKey: 'mr:1',
      worktreePath: null,
      person: 'nish',
      type: 'question',
      title: 'Use a middot?',
      context: '',
      options: [],
      suggested: null,
      detailsMd: null,
      action: null,
      actionArgs: null,
      digest: 'd1',
      createdAt: 1,
      source: 'engine',
      vaultRef: null
    })
    const input = { key: 'k', context: 'x', requirements: ['context' as const], maxAttempts: 3 }
    store.inboxPreparations.write('c1', queuedPreparation(input, 1))
    const tick = store.startTick('prepare', 1)
    store.runs.create({
      id: 'p1',
      automationId: 'prepare',
      tickId: tick,
      itemKey: 'c1',
      itemLabel: 'Use a middot?',
      worktreePath: null,
      startedAt: 1
    })
    const fields = {
      'preparation.item_id': 'c1',
      'preparation.attempt': 2,
      'preparation.requirements': 'context,diff,bogus',
      'preparation.origin_automation': 'one',
      'preparation.origin_run': 'asker',
      'preparation.error': 'Preparation lease expired'
    }
    store.recordDecisions(tick, [{ ...decision('c1'), fields }], new Map([['c1', 'p1']]))
    expect(runDetail(ctx, 'p1').preparation).toEqual({
      cardId: 'c1',
      cardTitle: 'Use a middot?',
      askedBy: '13 · Job',
      askedInRun: 'asker',
      needs: ['context', 'diff'],
      attempt: 2,
      maxAttempts: 3,
      lastError: 'Preparation lease expired'
    })
    store.close()
  })

  it('returns the handovers that started a stage-2 run, so its panel can link back to the sender', () => {
    const { ctx, store } = context()
    store.handovers.add({
      senderId: 'one',
      senderRunId: 'r1',
      receiverId: 'two',
      itemIds: ['WEB-1'],
      at: 3
    })
    const tick = store.startTick('two', 5)
    store.runs.create({
      id: 'r9',
      automationId: 'two',
      tickId: tick,
      itemKey: 'WEB-1',
      itemLabel: 'WEB-1',
      worktreePath: null,
      startedAt: 5,
      status: 'done'
    })
    const [row] = store.handovers.sentBy('r1')
    store.handovers.consume(tick, 6, [
      { rowId: row.id, verdict: 'started', reason: '', runId: 'r9' }
    ])
    expect(runDetail(ctx, 'r9').receivedFrom.map((h) => h.senderRunId)).toEqual(['r1'])
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
