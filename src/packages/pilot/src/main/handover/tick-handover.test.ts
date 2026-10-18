import { describe, expect, it } from 'vitest'
import type { ItemDecision, Verdict } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { HandledState } from '../../shared/tick/decide'
import { EMPTY_PEOPLE } from '../../shared/people'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import type { SourceAccess } from '../scheduler/tick-decide'
import { makeRunId, runTick, UnrecordedLaunchError, type TickDeps } from '../scheduler/tick-runner'
import type { IdsRunner } from '../sources/ids-from'
import { PilotStore } from '../store/store'
import { handOverRunEnd } from './hand-over'
import { repend } from './repend'
import { HANDOVER_EXPIRY_MS, settleFed, settles } from './tick-handover'

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
      feeds: [
        {
          to: 'starts',
          pass: { id: 'ticket' },
          run: 'now',
          when: 'success',
          caption: null,
          trust: 'shell'
        }
      ]
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
      at: d.now()
    })
    return d
  }

  it('consumes every id it read with its verdict and run; an id over the per-tick limit stays for the next tick', async () => {
    const d = fedDeps()
    const result = await runTick(STAGE_2, people, d, { dryRun: false })
    expect(result.decisions.map((x) => [x.label, x.verdict])).toEqual([
      ['WEB-1', 'started'],
      ['WEB-2', 'started'],
      ['WEB-3', 'held']
    ])
    expect(d.store.handovers.pending('starts', 10, 0).map((h) => h.itemId)).toEqual(['WEB-3'])
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
    expect(d.store.handovers.pending('starts', 10, 0)).toHaveLength(4)
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
    expect(d.store.handovers.pending('starts', 10, 0)).toHaveLength(4)
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

describe('settles: a fed id is consumed only when its tick started a run or the item definitely needs nothing', () => {
  const RETRY = 25 * 60_000
  const decision = (verdict: Verdict): ItemDecision => ({
    key: 'linear:WEB-1',
    label: 'WEB-1',
    verdict,
    reason: 'r',
    checks: [],
    onceKey: 'WEB-1',
    fields: {}
  })
  const handled = (state: HandledState) => new Map([['WEB-1', state]])
  const DONE: HandledState = { status: 'done', failedAt: null }
  const FAILED: HandledState = { status: 'failed', failedAt: 1 }
  it.each([
    ['a run started', decision('started'), new Map(), RETRY, true],
    ['a run held for an ask-first card', decision('asked'), new Map(), RETRY, true],
    ['out of scope', decision('out_of_scope'), new Map(), RETRY, true],
    ['baselined (recorded as handled)', decision('baselined'), new Map(), RETRY, true],
    ['already handled (once_per)', decision('notdue'), handled(DONE), RETRY, true],
    [
      'handled by a failed run, with no retry_after_failure',
      decision('notdue'),
      handled(FAILED),
      null,
      true
    ],
    ['gone from its source (closed, or not found)', undefined, new Map(), RETRY, true],
    ['waiting out retry_after_failure', decision('notdue'), handled(FAILED), RETRY, false],
    ['not due by its scope, never handled', decision('notdue'), new Map(), RETRY, false],
    [
      "skipped by a check or a field script's not due",
      decision('skipped'),
      new Map(),
      RETRY,
      false
    ],
    ['held by quota, a busy worktree or a limit', decision('held'), new Map(), RETRY, false]
  ] as [string, ItemDecision | undefined, Map<string, HandledState>, number | null, boolean][])(
    '%s → %s',
    (_name, d, states, retry, settled) => {
      expect(settles(d, states, retry)).toBe(settled)
    }
  )
})

describe('runTick: what a fed stage leaves pending', () => {
  const NOW = Date.UTC(2026, 9, 13, 18, 6)
  const FED = testDefinition({
    id: 'starts',
    file: '/a/starts.yaml',
    oncePer: '{ticket.id}',
    retryAfterFailureMs: 25 * 60_000,
    workspace: { kind: 'main_checkout' },
    items: {
      kind: 'linear_ticket',
      where: { ids_from: { feed: true } },
      match: [],
      customFields: []
    },
    job: { id: '13', name: null, stage: 2, label: 'Start fixes', feeds: [] }
  })
  const linear: SourceAccess = {
    list: async (_def, ctx) => ({
      items: (ctx.ids ?? []).map((id) =>
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
  function handed(ids: string[], at = NOW - 60_000) {
    const d = deps({ sources: linear, now: () => NOW })
    d.store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'run-1',
      receiverId: 'starts',
      itemIds: ids,
      at
    })
    return d
  }
  const pendingIds = (d: ReturnType<typeof handed>) =>
    d.store.handovers.pending('starts', 10, 0).map((h) => h.itemId)

  it('consumes an already handled ticket, and keeps one waiting out retry_after_failure', async () => {
    const d = handed(['WEB-1', 'WEB-2'])
    d.store.markHandled('starts', 'WEB-1', 'old-1', 1)
    d.store.setHandledStatus('starts', 'old-1', 'done', 1)
    d.store.markHandled('starts', 'WEB-2', 'old-2', 1)
    d.store.setHandledStatus('starts', 'old-2', 'failed', NOW - 60_000)
    const result = await runTick(FED, people, d, { dryRun: false })
    expect(result.decisions.map((x) => [x.label, x.verdict])).toEqual([
      ['WEB-1', 'notdue'],
      ['WEB-2', 'notdue']
    ])
    expect(pendingIds(d)).toEqual(['WEB-2'])
  })

  it('keeps a ticket its checks skipped, then consumes it on the tick that starts its run', async () => {
    const d = handed(['WEB-1'])
    const checked = { ...FED, checks: [{ kind: 'worktree_exists' as const }] }
    await runTick(checked, people, d, { dryRun: false })
    expect(pendingIds(d)).toEqual(['WEB-1'])
    await runTick(FED, people, d, { dryRun: false })
    expect(pendingIds(d)).toEqual([])
    expect(d.launched).toEqual(['linear:WEB-1'])
  })

  it('consumes a ticket out of scope', async () => {
    const d = handed(['WEB-1'])
    const outside = { ...FED, items: { ...FED.items!, match: ["{ticket.id} == 'WEB-9'"] } }
    const result = await runTick(outside, people, d, { dryRun: false })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['out_of_scope'])
    expect(pendingIds(d)).toEqual([])
  })

  it('expires a handover pending 7 days on the next real tick, without reading it; a dry run leaves it be', async () => {
    const d = handed(['WEB-1'], NOW - HANDOVER_EXPIRY_MS - 1)
    d.store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'run-2',
      receiverId: 'starts',
      itemIds: ['WEB-2'],
      at: NOW - 60_000
    })
    const dry = await runTick(FED, people, d, { dryRun: true })
    expect(dry.handover?.read).toEqual(['WEB-2'])
    expect(pendingIds(d)).toEqual(['WEB-1', 'WEB-2'])
    const real = await runTick(FED, people, d, { dryRun: false })
    expect(real.handover?.read).toEqual(['WEB-2'])
    expect(d.launched).toEqual(['linear:WEB-2'])
    expect(pendingIds(d)).toEqual([])
    expect(d.store.handovers.consumedBy([real.tickId]).get(real.tickId)).toEqual([
      expect.objectContaining({
        itemId: 'WEB-1',
        state: 'expired',
        tickId: real.tickId,
        consumedAt: NOW
      }),
      expect.objectContaining({ itemId: 'WEB-2', state: 'consumed', verdict: 'started' })
    ])
  })

  it('drops a fed id its source can’t read, with the reason, and never fails the tick; the rest still run', async () => {
    const d = handed(['WEB-1'])
    d.store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'run-x',
      receiverId: 'starts',
      itemIds: ['web 9', 'WEB-404'],
      at: NOW - 60_000
    })
    const missing: SourceAccess = {
      list: async (def, ctx) => {
        const listed = await linear.list(def, ctx)
        expect(ctx.ids).toEqual(['WEB-1', 'WEB-404'])
        return {
          ...listed,
          items: listed.items.filter((i) => i.label !== 'WEB-404'),
          missing: ['WEB-404']
        }
      },
      scope: () => null
    }
    const result = await runTick(FED, people, { ...d, sources: missing }, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual(['linear:WEB-1'])
    expect(pendingIds(d)).toEqual([])
    const settled = d.store.handovers.consumedBy([result.tickId]).get(result.tickId) ?? []
    expect(settled.map((h) => [h.itemId, h.state, h.reason])).toEqual([
      ['WEB-1', 'consumed', 'All checks pass'],
      ['web 9', 'expired', 'dropped: not a Linear id like WEB-123'],
      ['WEB-404', 'expired', 'dropped: not found by its source']
    ])
  })

  it('never starts a handed-over ticket its own list-fix-tickets doesn’t name yet: it waits, pending, the listed one runs', async () => {
    const d = handed(['WEB-9999', 'WEB-1'])
    const listing = {
      ...FED,
      items: {
        ...FED.items!,
        where: { ids_from: { feed: true, run: 'list-fix-tickets', field: 'identifier' } }
      }
    }
    const runIds: IdsRunner = async () => ({
      code: 0,
      stdout: '[{"identifier":"WEB-1"}]',
      stderr: '',
      timedOut: false,
      truncated: false
    })
    const result = await runTick(listing, people, { ...d, runIds }, { dryRun: false })
    expect(d.launched).toEqual(['linear:WEB-1'])
    const settled = d.store.handovers.consumedBy([result.tickId]).get(result.tickId) ?? []
    expect(settled.map((h) => [h.itemId, h.state, h.reason])).toEqual([
      ['WEB-1', 'consumed', 'All checks pass']
    ])
    expect(pendingIds(d)).toEqual(['WEB-9999'])
    expect(result.warnings).toContain(
      "WEB-9999 was handed over but isn't in the stage's own list yet; it waits (at most 7 days)"
    )
  })

  it.each([
    ['failed', true],
    ['timed_out', true],
    ['done', false],
    ['cancelled', false]
  ] as const)(
    'a run started for a fed id that ends %s puts it back to pending: %s',
    async (status, reopened) => {
      let now = NOW
      const d = handed(['WEB-1'])
      const clock = { ...d, now: () => now }
      const first = await runTick(FED, people, clock, { dryRun: false })
      const run = d.store.runs.forTick(first.tickId)[0]
      expect(pendingIds(d)).toEqual([])
      d.store.runs.update(run.id, { status })
      const ended = { ...run, status }
      handOverRunEnd(
        { store: d.store, now: () => now, definitionFor: () => FED, log: () => {} },
        ended,
        { status, outcome: status }
      )
      d.store.setHandledStatus('starts', run.id, reopened ? 'failed' : 'done', now)
      expect(pendingIds(d)).toEqual(reopened ? ['WEB-1'] : [])
      if (!reopened) {
        return
      }
      // retry_after_failure (25m) keeps it pending; past the wait the next tick starts it again.
      now += 60_000
      await runTick(FED, people, clock, { dryRun: false })
      expect(pendingIds(d)).toEqual(['WEB-1'])
      now += 25 * 60_000
      await runTick(FED, people, clock, { dryRun: false })
      expect(pendingIds(d)).toEqual([])
      expect(d.launched).toEqual(['linear:WEB-1', 'linear:WEB-1'])
    }
  )

  it.each([
    ['its launch threw (the run is released)', new Error('no terminal'), false],
    [
      'an agent runs untracked (the key stays held)',
      new UnrecordedLaunchError('t9', 'untracked agent'),
      false
    ],
    ['the engine closed it failed while opening it', null, true]
  ] as const)(
    'keeps a fed id pending when the run started for it failed at launch: %s',
    async (_name, thrown, closes) => {
      const d = handed(['WEB-1'])
      const launch: TickDeps['launch'] = async (req) => {
        if (thrown) {
          throw thrown
        }
        if (closes) {
          d.store.runs.update(req.runId, {
            status: 'failed',
            outcome: 'The automation starts is no longer loaded'
          })
          repend(d.store, req.runId)
        }
      }
      const result = await runTick(FED, people, { ...d, launch }, { dryRun: false })
      expect(result.decisions.map((x) => x.verdict)).toEqual(['started'])
      expect(pendingIds(d)).toEqual(['WEB-1'])
      expect(d.store.handovers.consumedBy([result.tickId]).get(result.tickId)).toBeUndefined()
    }
  )

  it('keeps a fed id pending, never consumed, when its source couldn’t read it this tick', async () => {
    const d = handed(['WEB-1', 'WEB-2'])
    const flaky: SourceAccess = {
      list: async (def, ctx) => {
        const listed = await linear.list(def, ctx)
        return {
          ...listed,
          items: listed.items.filter((i) => i.label !== 'WEB-2'),
          skipped: ['WEB-2']
        }
      },
      scope: () => null
    }
    const result = await runTick(FED, people, { ...d, sources: flaky }, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(pendingIds(d)).toEqual(['WEB-2'])
  })

  describe('settleFed: consuming as started or asked needs the run it started', () => {
    function oneFed(d: ReturnType<typeof handed>) {
      const [row] = d.store.handovers.pending('starts', 10, 0)
      return { fed: [row], dropped: [], missing: [], skipped: [] }
    }
    const decision = (verdict: 'started' | 'asked' | 'notdue') => ({
      key: 'linear:WEB-1',
      label: 'WEB-1',
      verdict,
      reason: verdict,
      checks: [],
      onceKey: 'WEB-1',
      fields: {}
    })

    it.each(['started', 'asked'] as const)(
      'keeps the id pending when the %s decision has no run (a card that failed to record, a launch never made)',
      (verdict) => {
        const d = handed(['WEB-1'])
        settleFed(d.store, FED, oneFed(d), [decision(verdict)], new Map(), 9, NOW)
        expect(pendingIds(d)).toEqual(['WEB-1'])
      }
    )

    it('consumes an already-handled id with the run that holds its key, so that run failing puts it back', () => {
      const d = handed(['WEB-1'])
      d.store.runs.create({
        id: 'held',
        automationId: 'starts',
        tickId: 1,
        itemKey: 'linear:WEB-1',
        itemLabel: 'WEB-1',
        worktreePath: null,
        startedAt: NOW
      })
      d.store.markHandled('starts', 'WEB-1', 'held', NOW)
      settleFed(d.store, FED, oneFed(d), [decision('notdue')], new Map(), 9, NOW)
      expect(pendingIds(d)).toEqual([])
      expect(d.store.handovers.consumedBy([9]).get(9)?.[0]).toMatchObject({
        itemId: 'WEB-1',
        runId: 'held'
      })
      repend(d.store, 'held')
      expect(pendingIds(d)).toEqual(['WEB-1'])
    })
  })
})
