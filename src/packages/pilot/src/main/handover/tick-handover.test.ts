import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { EMPTY_PEOPLE } from '../../shared/people'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import type { SourceAccess } from '../scheduler/tick-decide'
import { makeRunId, runTick, type TickDeps } from '../scheduler/tick-runner'
import { PilotStore } from '../store/store'

const people = EMPTY_PEOPLE
const repoItem = testItem({ kind: 'repo', key: 'repo:web-platform', label: 'web-platform' })
const repoSources: SourceAccess = {
  list: async () => ({ items: [repoItem], warnings: [] }),
  scope: () => null
}
const failingSources = (error: unknown): SourceAccess => ({
  list: async () => {
    throw error
  },
  scope: () => null
})

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { launched: string[] } {
  const launched: string[] = []
  const store = PilotStore.open(':memory:')
  return {
    launched,
    store,
    now: () => Date.UTC(2026, 9, 13, 18, 6),
    resolveRepo: async () => ({ name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: repoSources,
    fields: fakeFieldDeps(),
    ask: {
      store,
      now: () => 0,
      inbox: { store, now: () => 0, definitions: () => [], people: () => EMPTY_PEOPLE }
    },
    launch: async (req) => {
      launched.push(req.decision.key)
    },
    ...overrides
  }
}

describe('runTick: a stage fed ids by an earlier stage (job.feeds … pass)', () => {
  const STAGE_2 = testDefinition({
    id: 'starts',
    file: '/a/starts.yaml',
    oncePer: '{ticket.id}',
    limits: { perTick: 2, atOnce: null, timeoutMs: null, order: 'listed' },
    workspace: { kind: 'main_checkout' },
    items: {
      kind: 'linear_ticket',
      where: { ids_from: { feed: true } },
      match: [],
      customFields: []
    },
    job: { id: '13', name: null, stage: 2, label: 'Start fixes', feeds: [] }
  })
  const STAGE_1 = testDefinition({
    id: 'pipelines',
    file: '/a/pipelines.yaml',
    workspace: { kind: 'main_checkout' },
    steps: [testStep({ name: 'ticket', agent: 'shell', run: './t.sh', outputs: ['ticket'] })],
    job: {
      id: '13',
      name: 'N',
      stage: 1,
      label: 'Open the ticket',
      feeds: [{ to: 'starts', pass: { id: 'ticket' }, run: 'now', when: 'success', caption: null }]
    }
  })
  // A Linear source that reads each id it is handed; WEB-404 doesn't exist.
  const linearById: SourceAccess = {
    list: async (_def, ctx) => ({
      items: (ctx.ids ?? [])
        .filter((id) => id !== 'WEB-404')
        .map((id) =>
          testItem({
            kind: 'linear_ticket',
            key: `linear:${id}`,
            label: id,
            fields: { 'ticket.id': id }
          })
        ),
      warnings: []
    }),
    scope: () => null
  }
  function fedDeps(over: Partial<TickDeps> = {}) {
    const d = deps({ sources: linearById, ...over })
    d.store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'run-1',
      receiverId: 'starts',
      itemIds: ['WEB-1', 'WEB-2', 'WEB-404', 'WEB-3'],
      at: 1
    })
    return d
  }

  it('consumes every id it read with its verdict and run; an id over the per-tick limit stays for the next tick', async () => {
    const d = fedDeps()
    const result = await runTick(STAGE_2, people, d, { dryRun: false })
    expect(result.decisions.map((x) => [x.label, x.verdict])).toEqual([
      ['WEB-1', 'started'],
      ['WEB-2', 'started'],
      ['WEB-3', 'over_limit']
    ])
    expect(d.store.handovers.pending('starts', 10).map((h) => h.itemId)).toEqual(['WEB-3'])
    const consumed = d.store.handovers.consumedBy([result.tickId]).get(result.tickId) ?? []
    expect(consumed.map((h) => [h.itemId, h.verdict, h.runId, h.reason])).toEqual([
      ['WEB-1', 'started', makeRunId('starts', d.now(), 1, result.tickId), expect.any(String)],
      ['WEB-2', 'started', makeRunId('starts', d.now(), 2, result.tickId), expect.any(String)],
      ['WEB-404', null, null, 'Not read: its source returned no such item (closed, or not found)']
    ])
    expect(result.handover).toEqual({ read: ['WEB-1', 'WEB-2', 'WEB-404', 'WEB-3'], feeds: [] })
  })

  it('a dry run reads the pending ids and says so, consuming nothing', async () => {
    const d = fedDeps()
    const result = await runTick(STAGE_2, people, d, { dryRun: true })
    expect(result.handover?.read).toEqual(['WEB-1', 'WEB-2', 'WEB-404', 'WEB-3'])
    expect(d.store.handovers.pending('starts', 10)).toHaveLength(4)
    expect(d.launched).toEqual([])
  })

  it('a failed tick consumes nothing: its ids wait for the next one', async () => {
    const d = fedDeps({
      launch: async () => {
        throw new Error('unused')
      },
      sources: failingSources(new Error('Linear is down'))
    })
    const result = await runTick(STAGE_2, people, d, { dryRun: false })
    expect(result.status).toBe('failed')
    expect(d.store.handovers.pending('starts', 10)).toHaveLength(4)
  })

  it('records what triggered it, from the run that handed the ids over', async () => {
    const d = fedDeps()
    const trigger = { automationId: 'pipelines', runId: 'run-1', stage: 1, ids: ['WEB-1'] }
    const result = await runTick(STAGE_2, people, d, { dryRun: false, trigger })
    expect(d.store.handovers.tickTriggers([result.tickId])).toEqual(
      new Map([[result.tickId, trigger]])
    )
  })

  it('a sender’s dry run says what its runs would hand over, and to which stage', async () => {
    const d = deps({ sources: repoSources })
    const runOnce = { ...STAGE_1, items: null }
    const result = await runTick(runOnce, people, d, { dryRun: true })
    expect(result.handover).toEqual({
      read: [],
      feeds: [{ to: 'starts', output: 'ticket', run: 'now', when: 'success', starts: 1 }]
    })
  })

  it('an automation that is no stage of a job says nothing about handovers', async () => {
    const solo = testDefinition({ id: 'solo', items: null, workspace: { kind: 'main_checkout' } })
    const result = await runTick(solo, people, deps(), { dryRun: true })
    expect(result.handover).toBeUndefined()
  })
})
