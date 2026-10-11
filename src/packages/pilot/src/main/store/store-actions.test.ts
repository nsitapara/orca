import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import type { NewActionRun } from './store-actions'

const attempt = (extra: Partial<NewActionRun> = {}): NewActionRun => ({
  inboxItemId: 'i1',
  runId: 'r1',
  action: 'push',
  args: { iid: 1561, head: 'abc123' },
  digest: 'd1',
  phase: 'check',
  dryRun: false,
  startedAt: 10,
  ...extra
})

describe('ActionRunStore', () => {
  it('records an attempt as running, then how it ended', () => {
    const { actions } = PilotStore.open(':memory:')
    const id = actions.start(attempt())
    expect(actions.get(id)).toEqual({
      id,
      ...attempt(),
      status: 'running',
      output: null,
      finishedAt: null
    })
    actions.finish(id, 'refused', 'No push power', 12)
    expect(actions.get(id)).toMatchObject({
      status: 'refused',
      output: 'No push power',
      finishedAt: 12
    })
    expect(actions.get(999)).toBeNull()
  })

  it("lists an inbox item's attempts and a run's attempts, oldest first", () => {
    const { actions } = PilotStore.open(':memory:')
    const ready = actions.start(attempt({ phase: 'ready', startedAt: 20 }))
    const check = actions.start(attempt({ phase: 'check', startedAt: 10, dryRun: true }))
    actions.start(
      attempt({ inboxItemId: null, runId: 'r2', action: 'linear_comment', phase: 'do' })
    )
    expect(actions.forInboxItem('i1').map((a) => [a.id, a.phase, a.dryRun])).toEqual([
      [check, 'check', true],
      [ready, 'ready', false]
    ])
    expect(actions.forRun('r2').map((a) => a.action)).toEqual(['linear_comment'])
  })

  it.each(['done', 'failed', 'stale', 'needs_agent', 'not_yet', 'refused'] as const)(
    'keeps %s as the status an attempt ended with',
    (status) => {
      const { actions } = PilotStore.open(':memory:')
      const id = actions.start(attempt())
      actions.finish(id, status, '{"outcome":"x"}', 12)
      expect(actions.get(id)).toMatchObject({ status, output: '{"outcome":"x"}', finishedAt: 12 })
    }
  )
})
