import { describe, expect, it } from 'vitest'
import { devE2ePipelinesMapper, devE2eStartsMapper } from './dev-e2e'
import { stateReader } from './test-reader'

function reader(state: Record<string, unknown>) {
  return stateReader({ json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null), now: 1_000 })
}

describe('13 state import', () => {
  it('maps each handled pipeline to its once_per key and reports what it skips', () => {
    const plan = devE2ePipelinesMapper.plan(
      reader({ 'dev-e2e/handled.json': { '2933255582': ['WEB-2118'], bad: 'x' } })
    )
    expect(plan.handled).toEqual([
      { onceKey: '2933255582', status: 'done', at: 1_000, failedAt: null }
    ])
    expect(plan.notes).toEqual([
      `dev-e2e/handled.json: "bad" isn't "<pipeline id>": [tickets]; skipped`
    ])
  })

  it('marks a ticket handled only once its session started', () => {
    const tickets = {
      'WEB-2118': {
        jobs: ['a'],
        pipeline: 1,
        branch: 'b',
        path: '/wt/b',
        startedAt: '2026-10-10T13:12:00+00:00'
      },
      'WEB-2119': { jobs: ['a'], pipeline: 2, branch: 'c' }
    }
    const plan = devE2eStartsMapper.plan(reader({ 'dev-e2e/tickets.json': tickets }))
    expect(plan.handled).toEqual([
      {
        onceKey: 'WEB-2118',
        status: 'done',
        at: Date.parse('2026-10-10T13:12:00+00:00'),
        failedAt: null
      }
    ])
  })

  it('dates a started ticket with no readable start time at the import', () => {
    const plan = devE2eStartsMapper.plan(
      reader({ 'dev-e2e/tickets.json': { 'WEB-1': { path: '/wt/a', startedAt: 'soon' } } })
    )
    expect(plan.handled).toEqual([{ onceKey: 'WEB-1', status: 'done', at: 1_000, failedAt: null }])
  })

  it.each([
    ['missing', {}],
    ['empty', { 'dev-e2e/handled.json': {} }]
  ])('treats a %s state file as nothing to import', (_name, state) => {
    expect(devE2ePipelinesMapper.plan(reader(state)).handled).toEqual([])
  })

  it('notes a state file that is not an object and imports nothing from it', () => {
    const plan = devE2ePipelinesMapper.plan(reader({ 'dev-e2e/handled.json': [1] }))
    expect(plan.handled).toEqual([])
    expect(plan.notes).toEqual(['dev-e2e/handled.json: expected a JSON object'])
  })
})
