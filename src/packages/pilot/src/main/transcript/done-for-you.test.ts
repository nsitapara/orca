import { describe, expect, it } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { Effect } from '../../shared/visibility-types'
import { loadDefinitions } from '../definitions/loader'
import type { NewInboxItem } from '../store/store-inbox'
import { PilotStore } from '../store/store'
import { acknowledgeRuns, doneForYou } from './done-for-you'
import type { RunEffectsReader } from './run-effects'

const NOW = 10 * 24 * 3600_000

function card(id: string, runId: string, type: NewInboxItem['type']): NewInboxItem {
  return {
    id,
    automationId: 'mine',
    runId,
    stepIdx: 0,
    itemKey: 'k',
    worktreePath: null,
    person: 'nish',
    type,
    title: 't',
    context: 'c',
    options: [],
    suggested: null,
    detailsMd: null,
    action: null,
    actionArgs: null,
    digest: `d-${id}`,
    createdAt: NOW - 1000,
    source: 'engine',
    vaultRef: null
  }
}

function setup() {
  const store = PilotStore.open(':memory:')
  const loaded = {
    ...loadDefinitions([]),
    definitions: [
      testDefinition({ id: 'mine', inbox: 'nish' }),
      testDefinition({ id: 'theirs', inbox: 'emil' })
    ]
  }
  const ctx = {
    processKind: 'main' as const,
    store,
    dirs: [],
    loaded: () => loaded,
    reload: () => loaded,
    scheduler: { nextTickAt: () => null } as never,
    actions: { entries: () => [], get: () => null } as never,
    dispatcher: null,
    schedulerOn: true
  }
  const run = (id: string, automationId: string, finishedAt: number) => {
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey: id,
      itemLabel: id,
      worktreePath: null,
      startedAt: NOW - 5000,
      status: 'done'
    })
    store.runs.update(id, { finishedAt })
  }
  run('changed', 'mine', NOW - 4000)
  run('quiet', 'mine', NOW - 3500)
  run('defaulted', 'mine', NOW - 3000)
  run('other', 'theirs', NOW - 2000)
  store.inbox.add(card('d1', 'defaulted', 'default'))
  store.inbox.add(card('q1', 'quiet', 'question'))
  const pushed: Effect = {
    kind: 'pushed',
    target: 'web-1',
    url: null,
    count: 1,
    stepIdx: 0,
    at: NOW - 4500
  }
  const effects = {
    forRun: async (id: string) => (id === 'changed' || id === 'other' ? [pushed] : [])
  } as unknown as RunEffectsReader
  return { store, ctx: ctx as never, effects, pushed }
}

describe('doneForYou', () => {
  it("lists the person's finished runs that changed something or took a default, with their open defaults", async () => {
    const { ctx, effects, pushed } = setup()
    const done = await doneForYou(ctx, effects, 'nish', NOW)
    expect(done.map((d) => [d.run.id, d.effects, d.defaults.map((c) => c.id)])).toEqual([
      ['defaulted', [], ['d1']],
      ['changed', [pushed], []]
    ])
    expect((await doneForYou(ctx, effects, null, NOW)).map((d) => d.run.id)).toContain('other')
  })
})

describe('acknowledgeRuns', () => {
  it('acknowledges the runs and keeps their open defaults, reporting a card it could not keep', () => {
    const { store, ctx } = setup()
    store.inbox.add(card('d2', 'defaulted', 'default'))
    store.inbox.setStatus('d2', 'obsolete', NOW - 10)
    const result = acknowledgeRuns(ctx, ['defaulted', 'changed'], 'desktop', NOW)
    expect(result).toEqual({ acknowledged: ['defaulted', 'changed'], kept: ['d1'], notKept: [] })
    expect(store.inbox.get('d1')).toMatchObject({ status: 'answered', answer: { text: 'keep' } })
    expect(store.runs.get('changed')?.acknowledgedAt).toBe(NOW)
  })

  it('still acknowledges the run when a default refuses the Keep answer, and reports that card', () => {
    const { store, ctx } = setup()
    // The local CLI may never answer (save.ts), so every Keep is refused here.
    expect(acknowledgeRuns(ctx, ['defaulted'], 'local-cli', NOW)).toMatchObject({
      acknowledged: ['defaulted'],
      kept: [],
      notKept: [{ id: 'd1' }]
    })
    expect(store.inbox.get('d1')).toMatchObject({ status: 'open' })
  })
})
