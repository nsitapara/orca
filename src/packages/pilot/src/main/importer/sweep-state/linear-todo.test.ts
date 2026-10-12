import { describe, expect, it } from 'vitest'
import { linearTodoMapper } from './linear-todo'
import { stateReader } from './test-reader'

function reader(state: Record<string, unknown>) {
  return stateReader({ json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null), now: 5 })
}

describe('M01 state import', () => {
  it('marks every kicked-off ticket handled under its once_per key', () => {
    const started = {
      'WEB-2001': { path: '/wt/a', handle: 'term_1', startedAt: '2026-10-08T12:00:00+00:00' },
      'WEB-2002': { path: '/wt/b' }
    }
    expect(linearTodoMapper.plan(reader({ 'linear-todo/started.json': started })).handled).toEqual([
      {
        onceKey: 'WEB-2001',
        status: 'done',
        at: Date.parse('2026-10-08T12:00:00+00:00'),
        failedAt: null
      },
      { onceKey: 'WEB-2002', status: 'done', at: 5, failedAt: null }
    ])
  })

  it('imports nothing when the sweep never ran', () => {
    expect(linearTodoMapper.plan(reader({})).handled).toEqual([])
  })

  it('notes a started.json that is not an object and imports nothing', () => {
    const plan = linearTodoMapper.plan(reader({ 'linear-todo/started.json': [1] }))
    expect(plan.handled).toEqual([])
    expect(plan.notes).toEqual(['linear-todo/started.json: expected a JSON object'])
  })
})
