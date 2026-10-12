import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import { startRunEntry } from './start-run-entry'

const parsed = parseAutomationYaml(
  'name: Prepare reviews\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nstart: ask_first\nask_first: { title: Go? }\nsteps: [ { agent: claude, prompt: x } ]\n',
  '/a/rev.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const def = parsed.definition

function setup(start = vi.fn().mockResolvedValue(undefined), status = 'asking', tick = true) {
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
    entry: startRunEntry({ store, now: () => 50, definitions: () => [def], start })
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
      { outcome: 'failed', detail: 'Run rev-1-ask has no recorded tick to start from' }
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
      expect.objectContaining({ decision: expect.objectContaining({ onceKey: '1588:cd00' }) })
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
