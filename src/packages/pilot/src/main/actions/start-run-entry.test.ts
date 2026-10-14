import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { startRunEntry } from './start-run-entry'

const parsed = parseAutomationYaml(
  'name: Prepare reviews\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nstart: ask_first\nask_first: { title: Go? }\nsteps: [ { agent: claude, prompt: x } ]\n',
  '/a/rev.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const def = parsed.definition

function setup(
  start = vi.fn().mockResolvedValue(undefined),
  status = 'asking',
  tick = true,
  schedulerOn = true,
  displayOnly: string[] = []
) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-start-run-')), 'db.sqlite'))
  const tickId = store.startTick('rev', false, 1)
  store.recordDecisions(
    tickId,
    [
      {
        key: 'mr:1588',
        label: '!1588',
        verdict: 'asked',
        reason: 'Asks first',
        checks: [],
        onceKey: '1588:cd00',
        fields: { 'mr.iid': 1588 }
      }
    ],
    new Map()
  )
  store.runs.create({
    id: 'rev-1-ask',
    automationId: 'rev',
    tickId: tick ? tickId : null,
    itemKey: 'mr:1588',
    itemLabel: '!1588',
    worktreePath: '/wt',
    startedAt: 1,
    status: status as never,
    trigger: 'ask_first'
  })
  return {
    store,
    start,
    entry: startRunEntry({
      store,
      now: () => 50,
      definitions: () => [def],
      start,
      schedulerOn: () => schedulerOn,
      displayOnly: () => displayOnly
    })
  }
}

const ARGS = { run_id: 'rev-1-ask' }

describe('start_run', () => {
  it.each([
    ['a run id string', { run_id: 'r-1' }, null],
    ['no run id', {}, 'usage: start_run { "run_id" }'],
    ['an extra key', { run_id: 'r-1', x: 1 }, 'usage: start_run { "run_id" }'],
    ['a non-string run id', { run_id: 3 }, 'usage: start_run { "run_id" }']
  ])('checks args: %s', (_name, args, expected) => {
    expect(setup().entry.checkArgs(args)).toBe(expected)
  })

  it('needs no power because it only ever runs on an approval', () => {
    expect(setup().entry).toMatchObject({ name: 'start_run', power: null })
  })

  it('starts the asking run through the engine, with the decision its tick recorded', async () => {
    const { store, start, entry } = setup()
    expect(await entry.run(ARGS, { dryRun: false, runId: 'rev-1-ask' })).toMatchObject({
      outcome: 'done',
      detail: 'started run rev-1-ask'
    })
    expect(start).toHaveBeenCalledWith({
      runId: 'rev-1-ask',
      definition: def,
      decision: expect.objectContaining({
        key: 'mr:1588',
        label: '!1588',
        verdict: 'started',
        fields: { 'mr.iid': 1588 }
      })
    })
    expect(store.runs.get('rev-1-ask')?.status).toBe('running')
  })

  it.each([
    [
      'a run that is no longer asking',
      setup(undefined, 'cancelled'),
      ARGS,
      { outcome: 'stale', detail: 'run rev-1-ask is cancelled' }
    ],
    ['an unknown run', setup(), { run_id: 'nope' }, { outcome: 'failed', detail: 'No run nope' }],
    [
      'args without a run id',
      setup(),
      {},
      { outcome: 'failed', detail: 'usage: start_run { "run_id" }' }
    ],
    [
      'a run whose tick has aged out',
      setup(undefined, 'asking', false),
      ARGS,
      {
        outcome: 'failed',
        detail: 'Run rev-1-ask has no recorded tick to start from'
      }
    ],
    [
      'an automation whose file is invalid (shown from its last valid version only)',
      setup(undefined, 'asking', true, true, ['rev']),
      ARGS,
      {
        outcome: 'failed',
        detail: 'rev has an invalid definition; fix it before starting runs'
      }
    ],
    [
      "a process that doesn't run the scheduler",
      setup(undefined, 'asking', true, false),
      ARGS,
      { outcome: 'failed', detail: SCHEDULER_OFF }
    ]
  ])('refuses %s', async (_name, s, args, expected) => {
    expect(await s.entry.run(args, { dryRun: false, runId: 'rev-1-ask' })).toMatchObject(expected)
    expect(s.start).not.toHaveBeenCalled()
  })

  it('fails the run when its first step cannot start', async () => {
    const { store, entry } = setup(vi.fn().mockRejectedValue(new Error('No worktree for !1588')))
    expect(await entry.run(ARGS, { dryRun: false, runId: 'rev-1-ask' })).toMatchObject({
      outcome: 'failed',
      detail: "Couldn't start run rev-1-ask: No worktree for !1588"
    })
    expect(store.runs.get('rev-1-ask')).toMatchObject({
      status: 'failed',
      outcome: "Couldn't start: No worktree for !1588",
      finishedAt: 50
    })
  })

  // A start that failed launched nothing: the item's once_per key is freed so the head can be offered again.
  // An agent left running untracked (UnrecordedLaunchError) keeps it, so no tick starts a second one.
  it.each<[string, Error, string | null]>([
    ['frees the key of a start that failed', new Error('No worktree for !1588'), null],
    [
      'keeps the key while an untracked agent may run',
      new UnrecordedLaunchError('term-9', 'the runtime returned no pane to watch'),
      'rev-1-ask'
    ]
  ])('%s', async (_name, error, runId) => {
    const { store, entry } = setup(vi.fn().mockRejectedValue(error))
    store.markHandled('rev', '1588:cd00', 'rev-1-ask', 1)
    await entry.run(ARGS, { dryRun: false, runId: 'rev-1-ask' })
    const handled = store.handledRows('rev').find((r) => r.onceKey === '1588:cd00')
    expect(handled?.runId ?? null).toBe(runId)
  })

  it('puts a handed-over id this run took back to pending when it can’t start', async () => {
    const { store, entry } = setup(vi.fn().mockRejectedValue(new Error('no worktree')))
    store.handovers.add({
      senderId: 'open',
      senderRunId: 'r0',
      receiverId: 'rev',
      itemIds: ['1588'],
      at: 1
    })
    const [row] = store.handovers.pending('rev', 10)
    store.handovers.consume(1, 2, [
      { rowId: row.id, verdict: 'asked', reason: 'Asks first', runId: 'rev-1-ask' }
    ])
    await entry.run(ARGS, { dryRun: false, runId: 'rev-1-ask' })
    expect(store.runs.get('rev-1-ask')?.status).toBe('failed')
    expect(store.handovers.pending('rev', 10).map((h) => h.itemId)).toEqual(['1588'])
  })

  it("starts nothing for a card that belongs to a different run (an agent's card naming another's run)", async () => {
    const { store, start, entry } = setup()
    expect(await entry.run(ARGS, { dryRun: false, runId: 'agent-1' })).toMatchObject({
      outcome: 'failed',
      detail: 'start_run only runs from the card of run rev-1-ask'
    })
    expect(await entry.run(ARGS, { dryRun: false, runId: null })).toMatchObject({
      outcome: 'failed'
    })
    expect(start).not.toHaveBeenCalled()
    expect(store.runs.get('rev-1-ask')?.status).toBe('asking')
  })

  it('launches with the once_per key the tick marked handled for the run', async () => {
    const { store, start, entry } = setup()
    store.markHandled('rev', '1588:cd00', 'rev-1-ask', 1)
    await entry.run(ARGS, { dryRun: false, runId: 'rev-1-ask' })
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ onceKey: '1588:cd00' })
      })
    )
  })

  it('starts nothing on a dry run', async () => {
    const { store, start, entry } = setup()
    expect(await entry.run(ARGS, { dryRun: true, runId: null })).toMatchObject({
      outcome: 'done',
      detail: 'would start run rev-1-ask'
    })
    expect(start).not.toHaveBeenCalled()
    expect(store.runs.get('rev-1-ask')?.status).toBe('asking')
  })
})
