import { describe, expect, it, vi } from 'vitest'
import type { InboxStatus, ItemFields, RunRow, StepStatus } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { queuedPreparation, type InboxPreparation } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import { continueRun, type ContinueRunDeps } from './run-continue'

const SESSION = '00000000-0000-4000-8000-0000000000f1'
const REASON = 'The terminal closed before the agent finished'
const DEF = testDefinition({
  id: 'review',
  steps: [
    testStep({ name: 'context', agent: 'shell', run: 'echo' }),
    testStep({ name: 'review' }),
    testStep({ name: 'flag_failed', agent: 'shell', run: 'echo', always: true })
  ]
})
type Step = { name: string; agent: string; status: StepStatus; sessionId?: string; error?: string }
// The 7:20 PM review: context done, review's terminal closed under it, flag_failed ran because it failed.
const BROKEN: Step[] = [
  { name: 'context', agent: 'shell', status: 'done' },
  { name: 'review', agent: 'claude', status: 'failed', sessionId: SESSION, error: REASON },
  { name: 'flag_failed', agent: 'shell', status: 'done' }
]

function recordTick(store: PilotStore, fields: ItemFields): number {
  const tickId = store.startTick('review', 1)
  const decision = { key: 'mr:1', label: '!1', verdict: 'started' as const, reason: '', checks: [] }
  store.recordDecisions(tickId, [{ ...decision, onceKey: '1:9', fields }], new Map())
  return tickId
}

function setup(
  over: {
    def?: AutomationDefinition | null
    steps?: Step[]
    run?: Partial<Pick<RunRow, 'status' | 'trigger'>>
    deps?: Partial<ContinueRunDeps>
    // The item fields the run's tick decided it on: the run gets a tick only when given them.
    tickFields?: ItemFields
  } = {}
) {
  const store = PilotStore.open(':memory:')
  const def = over.def === undefined ? DEF : over.def
  store.runs.create({
    id: 'run-1',
    automationId: 'review',
    tickId: over.tickFields ? recordTick(store, over.tickFields) : null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt',
    startedAt: 1,
    trigger: over.run?.trigger
  })
  store.markHandled('review', '1:9', 'run-1', 1)
  for (const [idx, s] of (over.steps ?? BROKEN).entries()) {
    store.runs.createStep({
      runId: 'run-1',
      idx,
      name: s.name,
      agent: s.agent,
      skill: null,
      startedAt: 2,
      sessionId: s.sessionId ?? null
    })
    store.runs.updateStep('run-1', idx, { status: s.status, finishedAt: 3, error: s.error ?? '' })
  }
  const status = over.run?.status ?? 'failed'
  store.runs.update('run-1', { status, outcome: `Step review failed: ${REASON}`, finishedAt: 4 })
  store.setHandledStatus('review', 'run-1', 'failed', 4)
  const continued = vi.fn(async () => {})
  const deps: ContinueRunDeps = {
    store,
    now: () => 10,
    definitionFor: (id) => (id === 'review' ? def : null),
    capacity: { hasFreeSlot: () => true },
    launcherDeps: { transcriptExists: async () => true },
    wired: { engine: { continueRun: continued } },
    ...over.deps
  }
  return { store, deps, continued }
}

describe('continueRun', () => {
  it("reopens a failed run at the step that broke, keeps the steps before it, and resumes that step's session", async () => {
    const { store, deps, continued } = setup()
    await expect(continueRun(deps, 'run-1')).resolves.toEqual({ step: 'review', resumed: true })
    // It ended at 4 and goes on at 10: those 6 ms count as idle, not worked.
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'running',
      outcome: null,
      finishedAt: null,
      idleMs: 6
    })
    expect(store.runs.steps('run-1').map((s) => [s.name, s.status, s.sessionId])).toEqual([
      ['context', 'done', null],
      ['review', 'pending', SESSION]
    ])
    expect(store.handledRows('review')).toMatchObject([{ status: 'started', failedAt: null }])
    expect(continued).toHaveBeenCalledWith('run-1', { idx: 1, sessionId: SESSION, reason: REASON })
    const events = store.events.list({ runId: 'run-1', kinds: ['run_continued'] })
    expect(events.map((e) => e.payload)).toEqual([{ step: 'review', resumed: true }])
  })

  it.each<[string, Step[], Partial<ContinueRunDeps>, string]>([
    [
      'a step that has no session',
      [BROKEN[0], { ...BROKEN[1], sessionId: undefined }, BROKEN[2]],
      {},
      'review'
    ],
    [
      'a session whose transcript is gone',
      BROKEN,
      { launcherDeps: { transcriptExists: async () => false } },
      'review'
    ],
    [
      'a shell step',
      [{ ...BROKEN[0], status: 'timed_out' }, { ...BROKEN[1], status: 'skipped' }, BROKEN[2]],
      {},
      'context'
    ],
    [
      'a run that broke between steps, at the first step it never reached',
      [BROKEN[0]],
      {},
      'review'
    ]
  ])('starts the step over for %s', async (_name, steps, deps, step) => {
    const { deps: built, continued } = setup({ steps, deps })
    await expect(continueRun(built, 'run-1')).resolves.toEqual({ step, resumed: false })
    expect(continued).toHaveBeenCalledWith('run-1', null)
  })

  it.each<[string, Parameters<typeof setup>[0], string]>([
    ['a run still going', { run: { status: 'running' } }, 'is running'],
    ['an answer run', { run: { trigger: 'answer' } }, 'answer'],
    ['an automation that is no longer loaded', { def: null }, 'no longer loaded'],
    [
      'a run in an env workspace',
      {
        def: testDefinition({
          ...DEF,
          workspace: {
            kind: 'env',
            subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
            writes: true,
            stack: { field: 'mr.stack' }
          }
        })
      },
      'env'
    ],
    [
      'a stage that reads handed-over work',
      {
        def: testDefinition({
          ...DEF,
          items: {
            kind: 'merge_request',
            where: { ids_from: { feed: true } },
            match: [],
            customFields: []
          }
        })
      },
      'handed over'
    ],
    [
      'an automation whose steps changed',
      { def: testDefinition({ ...DEF, steps: [testStep({ name: 'context' })] }) },
      'steps changed'
    ],
    [
      'a run whose every step finished',
      { steps: BROKEN.map((s) => ({ ...s, status: 'done' })) },
      'nothing left'
    ],
    ['no free run slot', { deps: { capacity: { hasFreeSlot: () => false } } }, 'slot']
  ])('refuses %s and changes nothing', async (_name, over, why) => {
    const { store, deps, continued } = setup(over)
    const before = { run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }
    await expect(continueRun(deps, 'run-1')).rejects.toThrow(why)
    expect({ run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }).toEqual(before)
    expect(continued).not.toHaveBeenCalled()
  })

  it('refuses while another run works in the same worktree', async () => {
    const { store, deps, continued } = setup()
    store.runs.create({
      id: 'run-2',
      automationId: 'merge-dev',
      tickId: null,
      itemKey: 'wt:1',
      itemLabel: 'web-1',
      worktreePath: '/wt',
      startedAt: 5
    })
    await expect(continueRun(deps, 'run-1')).rejects.toThrow('run-2')
    expect(store.runs.get('run-1')?.status).toBe('failed')
    expect(continued).not.toHaveBeenCalled()
  })
})

// Job 14: the run's item is a card (here mr:1), bound by its tick to one revision of the card's preparation.
describe('continueRun on a context-preparation run', () => {
  const PREPARE = testDefinition({
    id: 'review',
    items: { kind: 'inbox_preparation', where: {}, match: [], customFields: [] },
    steps: [testStep({ name: 'prepare', skill: 'prepare-inbox-item-context' })]
  })
  const queued = queuedPreparation(
    { key: 'decision', context: 'Investigate', requirements: ['context'] },
    1
  )

  function preparing(status: InboxStatus, preparation: InboxPreparation) {
    const built = setup({
      def: PREPARE,
      steps: [{ name: 'prepare', agent: 'claude', status: 'failed', error: 'lease expired' }],
      tickFields: { 'preparation.item_id': 'mr:1', 'preparation.revision': 1 }
    })
    built.store.inbox.add({
      id: 'mr:1',
      automationId: 'origin',
      runId: null,
      stepIdx: null,
      itemKey: 'mr:9',
      worktreePath: '/wt',
      person: 'nish',
      type: 'question',
      title: 'Decision',
      context: 'Context',
      options: [],
      suggested: null,
      detailsMd: null,
      action: null,
      actionArgs: null,
      digest: 'digest',
      createdAt: 1,
      source: 'engine',
      vaultRef: null,
      preparation
    })
    if (status !== 'open') {
      built.store.inbox.update('mr:1', { status }, 5)
    }
    return built
  }

  it.each<[string, InboxStatus, InboxPreparation, string]>([
    ['an answered card', 'done', queued, 'Nothing to continue: the card was already answered'],
    [
      'a card another run prepared',
      'open',
      { ...queued, state: 'ready', attempt: 1, runId: 'run-2', stepIdx: 0 },
      'Nothing to continue: run run-2 already prepared this card'
    ],
    [
      'a card queued again since',
      'open',
      { ...queued, revision: 2 },
      'Nothing to continue: the card was queued again since this run took it'
    ],
    [
      'a blocked preparation',
      'open',
      { ...queued, state: 'blocked', attempt: 1, runId: 'run-1', stepIdx: 0 },
      "Can't continue: its preparation is blocked until you Retry it on the card"
    ]
  ])('refuses %s and changes nothing', async (_name, status, preparation, why) => {
    const { store, deps, continued } = preparing(status, preparation)
    const before = { run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }
    await expect(continueRun(deps, 'run-1')).rejects.toThrow(why)
    expect({ run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }).toEqual(before)
    expect(continued).not.toHaveBeenCalled()
  })

  it("goes on while the preparation is still the run's to take", async () => {
    const { deps, continued } = preparing('open', queued)
    await expect(continueRun(deps, 'run-1')).resolves.toEqual({ step: 'prepare', resumed: false })
    expect(continued).toHaveBeenCalledWith('run-1', null)
  })
})
