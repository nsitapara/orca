import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { Effect } from '../../shared/visibility-types'
import { loadDefinitions } from '../definitions/loader'
import type { NewInboxItem } from '../store/store-inbox'
import { PilotStore } from '../store/store'
import { acknowledgeRuns, doneForYou } from './done-for-you'
import { LogReader } from './log-file'
import { RunEffectsReader } from './run-effects'
import { lines, result, T0, use as toolUse } from './__fixtures__/transcript'

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
    people: {
      people: [
        { id: 'nish', name: 'Nish', gitlab: 'nish-gl' },
        { id: 'emil', name: 'Emil' }
      ],
      groups: [{ id: 'team', name: 'Team', members: ['nish', 'emil'] }]
    },
    definitions: [
      testDefinition({ id: 'mine', inbox: 'nish' }),
      testDefinition({ id: 'theirs', inbox: 'emil' }),
      testDefinition({ id: 'tpl', inbox: '{mr.author}' }),
      testDefinition({ id: 'grp', inbox: 'team' })
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
  return { store, ctx: ctx as never, effects, pushed, run }
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

function tickRun(store: PilotStore, id: string, automationId: string, author: string) {
  const tick = store.startTick(automationId, NOW - 6000)
  store.recordDecisions(
    tick,
    [
      {
        key: id,
        label: id,
        verdict: 'started',
        reason: '',
        checks: [],
        onceKey: id,
        fields: { 'mr.author': author }
      }
    ],
    new Map([[id, id]])
  )
  store.runs.create({
    id,
    automationId,
    tickId: tick,
    itemKey: id,
    itemLabel: id,
    worktreePath: null,
    startedAt: NOW - 5000,
    status: 'done'
  })
  store.runs.update(id, { finishedAt: NOW - 1500 })
}

describe('doneForYou routing and paging', () => {
  it("routes a template inbox by the run's own fields, and a group to its members", async () => {
    const { store, ctx, run } = setup()
    const everything = {
      forRun: async () => [{ kind: 'pushed', target: 't', url: null, count: 1, stepIdx: 0, at: 1 }]
    } as unknown as RunEffectsReader
    tickRun(store, 'by-handle', 'tpl', 'nish-gl')
    tickRun(store, 'by-id', 'tpl', 'nish')
    tickRun(store, 'by-other', 'tpl', 'emil')
    run('grouped', 'grp', NOW - 1200)
    const ids = (await doneForYou(ctx, everything, 'nish', NOW)).map((d) => d.run.id)
    expect(ids).toContain('by-handle')
    expect(ids).toContain('by-id')
    expect(ids).toContain('grouped')
    expect(ids).not.toContain('by-other')
    expect(ids).not.toContain('other')
  })

  it('pages past quiet runs to a run with effects', async () => {
    const { store, ctx } = setup()
    store.runs.create({
      id: 'busy',
      automationId: 'mine',
      tickId: null,
      itemKey: 'b',
      itemLabel: 'b',
      worktreePath: null,
      startedAt: 1,
      status: 'done'
    })
    store.runs.update('busy', { finishedAt: NOW - 9000 })
    for (let i = 0; i < 120; i += 1) {
      store.runs.create({
        id: `q${i}`,
        automationId: 'mine',
        tickId: null,
        itemKey: 'q',
        itemLabel: 'q',
        worktreePath: null,
        startedAt: 1,
        status: 'done'
      })
      store.runs.update(`q${i}`, { finishedAt: NOW - 8000 + i })
    }
    const effects = {
      forRun: async (id: string) =>
        id === 'busy'
          ? [{ kind: 'pushed', target: 't', url: null, count: 1, stepIdx: 0, at: 1 }]
          : []
    } as unknown as RunEffectsReader
    expect((await doneForYou(ctx, effects, 'nish', NOW)).map((d) => d.run.id)).toContain('busy')
  })
})

describe('doneForYou reading effects', () => {
  it('reads the recent Linear URLs at most once for a whole poll of many runs', async () => {
    const { store, ctx, run } = setup()
    const root = mkdtempSync(join(tmpdir(), 'pilot-done-'))
    mkdirSync(join(root, 'proj'))
    writeFileSync(
      join(root, 'proj', 'sess-1.jsonl'),
      lines(
        toolUse(1, 't1', 'Bash', { command: 'orca linear comment add WEB-5' }),
        result(2, 't1', 'ok')
      )
    )
    for (let i = 0; i < 30; i += 1) {
      run(`quiet-${i}`, 'mine', NOW - 100 - i)
    }
    for (const id of ['ticket-a', 'ticket-b']) {
      run(id, 'mine', NOW - 50)
      store.runs.createStep({
        runId: id,
        idx: 0,
        name: 'fix',
        agent: 'claude',
        skill: 'x',
        startedAt: T0,
        sessionId: 'sess-1'
      })
      store.runs.updateStep(id, 0, { finishedAt: T0 + 30_000, status: 'done' })
    }
    const recent = vi.spyOn(store.visibility, 'recentLinearUrls')
    const reader = new RunEffectsReader({
      store,
      reader: new LogReader(root),
      claudeProjects: root,
      remoteOf: async () => null
    })
    const ids = (await doneForYou(ctx, reader, 'nish', NOW)).map((d) => d.run.id)
    expect(ids).toContain('ticket-a')
    expect(ids).toContain('ticket-b')
    expect(recent.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

describe('acknowledgeRuns', () => {
  it('keeps a duplicated id once, and not the defaults of a run acknowledged earlier or still running', () => {
    const { store, ctx, run } = setup()
    expect(acknowledgeRuns(ctx, ['defaulted', 'defaulted'], 'desktop', NOW)).toEqual({
      acknowledged: ['defaulted'],
      kept: ['d1'],
      notKept: []
    })
    run('early', 'mine', NOW - 900)
    store.inbox.add(card('d3', 'early', 'default'))
    store.visibility.acknowledge(['early'], NOW - 5)
    store.runs.create({
      id: 'live',
      automationId: 'mine',
      tickId: null,
      itemKey: 'l',
      itemLabel: 'l',
      worktreePath: null,
      startedAt: 1,
      status: 'running'
    })
    store.inbox.add(card('d4', 'live', 'default'))
    expect(acknowledgeRuns(ctx, ['early', 'live'], 'desktop', NOW)).toEqual({
      acknowledged: [],
      kept: [],
      notKept: []
    })
    expect(store.inbox.get('d3')).toMatchObject({ status: 'open' })
    expect(store.inbox.get('d4')).toMatchObject({ status: 'open' })
  })

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
