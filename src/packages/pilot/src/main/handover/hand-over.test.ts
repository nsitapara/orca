import { describe, expect, it, vi } from 'vitest'
import type { ItemFields, RunRow, RunTrigger, TickTrigger } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition, FeedDef } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import { PilotStore } from '../store/store'
import { handOverRunEnd, idsInOutput } from './hand-over'

const AT = Date.UTC(2026, 9, 13, 18, 5)
const DONE: RunEnd = { status: 'done', outcome: 'Done' }
const FAILED: RunEnd = { status: 'failed', outcome: 'Step ticket failed' }

function feed(over: Partial<FeedDef> = {}): FeedDef {
  return {
    to: 'dev-e2e-fix-start',
    pass: { id: 'ticket' },
    run: 'now',
    when: 'success',
    caption: null,
    ...over
  }
}
function sender(feeds: FeedDef[]): AutomationDefinition {
  return testDefinition({
    id: 'dev-e2e-fix',
    job: { id: '13', name: 'N', stage: 1, label: 'Open the ticket', feeds },
    steps: [testStep({ name: 'ticket', agent: 'shell', run: './t.sh', outputs: ['ticket'] })]
  })
}

// A run of the sender whose steps reported these outputs, one step per entry.
function setup(def: AutomationDefinition, outputs: ItemFields[], trigger: RunTrigger = 'schedule') {
  const store = PilotStore.open(':memory:')
  const run: RunRow = {
    id: 'dev-e2e-fix-202610131805-t4-1',
    automationId: def.id,
    tickId: 4,
    itemKey: 'pipeline:77',
    itemLabel: '#77',
    worktreePath: '/repo',
    status: 'done',
    outcome: 'Done',
    startedAt: AT - 60_000,
    finishedAt: AT,
    costUsd: null,
    tokens: null,
    worktreeId: null,
    trigger,
    parentRunId: null,
    imported: false
  }
  store.runs.create({ ...run, status: 'running' })
  outputs.forEach((o, idx) => {
    store.runs.createStep({
      runId: run.id,
      idx,
      name: `s${idx}`,
      agent: 'shell',
      skill: null,
      startedAt: AT
    })
    store.advance.mergeStepOutputs(run.id, idx, o)
  })
  const triggered: [string, TickTrigger][] = []
  const logs: string[] = []
  const deps = {
    store,
    now: () => AT,
    definitionFor: (id: string) => (id === def.id ? def : null),
    trigger: (id: string, cause: TickTrigger) => triggered.push([id, cause]),
    log: (m: string) => logs.push(m)
  }
  const pending = () =>
    store.handovers.pending('dev-e2e-fix-start', 50).map((h) => [h.senderRunId, h.itemId])
  return { store, run, deps, triggered, logs, pending }
}

describe('idsInOutput: the ids an output hands over', () => {
  it.each([
    ['one id', 'WEB-2123', ['WEB-2123'], []],
    [
      'several, by commas or spaces, each once',
      'WEB-1, WEB-2 WEB-1,,WEB-3',
      ['WEB-1', 'WEB-2', 'WEB-3'],
      []
    ],
    ['a whole number', 42, ['42'], []],
    ['nothing', '', [], []],
    ['no value', undefined, [], []],
    ['a value that is no id', true, [], ['true']],
    ['an id with a control character', 'WEB-1\u0007', [], ['WEB-1\u0007']]
  ])('%s', (_name, value, ids, refused) => {
    expect(idsInOutput(value)).toEqual({ ids, refused })
  })
})

describe('handOverRunEnd: a stage run that ends hands its output to the next stage', () => {
  it('writes each id from the passed output, then asks for a tick of the receiver (run: now) naming the run and the ids', () => {
    const s = setup(sender([feed()]), [
      { ticket: 'WEB-2123,WEB-2124', tickets: 'WEB-2123,WEB-2124' }
    ])
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([
      [s.run.id, 'WEB-2123'],
      [s.run.id, 'WEB-2124']
    ])
    expect(s.triggered).toEqual([
      [
        'dev-e2e-fix-start',
        { automationId: 'dev-e2e-fix', runId: s.run.id, stage: 1, ids: ['WEB-2123', 'WEB-2124'] }
      ]
    ])
  })

  it('reads the output from the last step that reported it', () => {
    const s = setup(sender([feed()]), [{ ticket: 'WEB-1' }, { other: 1 }, { ticket: 'WEB-2' }])
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([[s.run.id, 'WEB-2']])
  })

  it('leaves the ids for the receiver’s schedule with run: next_schedule', () => {
    const s = setup(sender([feed({ run: 'next_schedule' })]), [{ ticket: 'WEB-2123' }])
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([[s.run.id, 'WEB-2123']])
    expect(s.triggered).toEqual([])
  })

  it.each([
    ['done', DONE, 'success', true],
    [
      'needs you (its steps passed; cards wait)',
      { status: 'needs_you', outcome: 'Inbox: 1 open item' },
      'success',
      true
    ],
    ['failed', FAILED, 'success', false],
    ['timed out', { status: 'timed_out', outcome: 'Step ticket timed out' }, 'success', false],
    ['cancelled', { status: 'cancelled', outcome: 'Cancelled' }, 'success', false],
    ['failed, with when: always', FAILED, 'always', true]
  ] as const)('a run that ended %s hands over: %s → %s', (_name, end, when, hands) => {
    const s = setup(sender([feed({ when })]), [{ ticket: 'WEB-2123' }])
    handOverRunEnd(s.deps, s.run, end)
    expect(s.pending().length > 0).toBe(hands)
    expect(s.triggered.length > 0).toBe(hands)
  })

  it('hands nothing, and triggers nothing, when the run reported no id', () => {
    for (const outputs of [[{ tickets: 'none' }], [{ ticket: '' }], []]) {
      const s = setup(sender([feed()]), outputs)
      handOverRunEnd(s.deps, s.run, DONE)
      expect(s.pending()).toEqual([])
      expect(s.triggered).toEqual([])
    }
  })

  it('skips an output value that is no id, and says so', () => {
    const s = setup(sender([feed()]), [{ ticket: true }])
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([])
    expect(s.logs.join('\n')).toContain('ticket: "true" is not an id; not handed over')
  })

  it('ticks the receiver of a run: now feed without pass, with no ids', () => {
    const s = setup(sender([feed({ pass: null })]), [])
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([])
    expect(s.triggered).toEqual([
      ['dev-e2e-fix-start', { automationId: 'dev-e2e-fix', runId: s.run.id, stage: 1, ids: [] }]
    ])
  })

  it('does nothing for an arrow-only feed, an automation that is no stage, or a run that applies an answer', () => {
    const arrow = setup(sender([feed({ pass: null, run: 'next_schedule' })]), [{ ticket: 'WEB-1' }])
    handOverRunEnd(arrow.deps, arrow.run, DONE)
    const solo = setup({ ...sender([]), job: null }, [{ ticket: 'WEB-1' }])
    handOverRunEnd(solo.deps, solo.run, DONE)
    const answer = setup(sender([feed()]), [{ ticket: 'WEB-1' }], 'answer')
    handOverRunEnd(answer.deps, answer.run, DONE)
    const imported = setup(sender([feed()]), [{ ticket: 'WEB-1' }], 'import')
    handOverRunEnd(imported.deps, imported.run, DONE)
    for (const s of [arrow, solo, answer, imported]) {
      expect(s.pending()).toEqual([])
      expect(s.triggered).toEqual([])
    }
  })

  it('hands over again on a repeat call without writing an id twice', () => {
    const s = setup(sender([feed({ run: 'next_schedule' })]), [{ ticket: 'WEB-1' }])
    handOverRunEnd(s.deps, s.run, DONE)
    handOverRunEnd(s.deps, s.run, DONE)
    expect(s.pending()).toEqual([[s.run.id, 'WEB-1']])
  })

  it('logs a failed planning read and hands nothing over, so the run’s end stands', () => {
    const s = setup(sender([feed()]), [{ ticket: 'WEB-1' }])
    vi.spyOn(s.store.runs, 'steps').mockImplementation(() => {
      throw new Error('database is closed')
    })
    expect(() => handOverRunEnd(s.deps, s.run, DONE)).not.toThrow()
    expect(s.logs.join('\n')).toContain('database is closed')
    expect(s.pending()).toEqual([])
    expect(s.triggered).toEqual([])
  })

  it('throws when a handover row can’t be written, so closeRun rolls the run’s end back with it', () => {
    const s = setup(sender([feed()]), [{ ticket: 'WEB-1' }])
    vi.spyOn(s.store.handovers, 'add').mockImplementation(() => {
      throw new Error('disk I/O error')
    })
    expect(() => handOverRunEnd(s.deps, s.run, DONE)).toThrow('disk I/O error')
    expect(s.triggered).toEqual([])
  })

  it('keeps the rows when the trigger fails after the commit: they wait for the next tick', () => {
    const s = setup(sender([feed()]), [{ ticket: 'WEB-1' }])
    const deps = {
      ...s.deps,
      trigger: () => {
        throw new Error('scheduler gone')
      }
    }
    handOverRunEnd(deps, s.run, DONE)
    expect(s.pending()).toEqual([[s.run.id, 'WEB-1']])
    expect(s.logs.join('\n')).toContain(
      "couldn't trigger dev-e2e-fix-start: scheduler gone; its ids stay pending"
    )
  })
})
