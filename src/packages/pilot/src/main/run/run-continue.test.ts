import { describe, expect, it, vi } from 'vitest'
import type { RunRow, StepStatus } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
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

function setup(
  over: {
    def?: AutomationDefinition | null
    steps?: Step[]
    run?: Partial<Pick<RunRow, 'status' | 'trigger'>>
    deps?: Partial<ContinueRunDeps>
  } = {}
) {
  const store = PilotStore.open(':memory:')
  const def = over.def === undefined ? DEF : over.def
  store.runs.create({
    id: 'run-1',
    automationId: 'review',
    tickId: null,
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
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'running',
      outcome: null,
      finishedAt: null
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
