import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import { ACTION_INTERRUPTED, type NewActionRun } from './store-actions'

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
    // While it runs, its output names the process running it (the interrupt sweep reads it).
    expect(actions.get(id)).toEqual({
      id,
      ...attempt(),
      status: 'running',
      output: JSON.stringify({ writer: process.pid }),
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

  it('marks attempts a stop left running as failed and interrupted, and leaves the rest', () => {
    const { actions } = PilotStore.open(':memory:')
    const left = actions.start(attempt({ phase: 'do', startedAt: 10 }))
    const done = actions.start(attempt({ phase: 'do', startedAt: 11 }))
    actions.finish(done, 'done', null, 12)
    const fresh = actions.start(attempt({ phase: 'do', startedAt: 30 }))
    expect(actions.interruptRunning(20, 25, () => true)).toBe(1)
    expect(actions.get(left)).toMatchObject({ status: 'failed', finishedAt: 25 })
    expect(JSON.parse(actions.get(left)!.output!)).toMatchObject({
      outcome: 'failed',
      detail: ACTION_INTERRUPTED
    })
    expect([actions.get(done)?.status, actions.get(fresh)?.status]).toEqual(['done', 'running'])
  })

  // Fix round 1: main and orcad both open Pilot's store; one sharing a file must not close the other's.
  it('interrupts only attempts whose writing process is gone', () => {
    const { actions } = PilotStore.open(':memory:')
    const mine = actions.start(attempt({ phase: 'do', startedAt: 10 }))
    const other = actions.start(attempt({ phase: 'do', startedAt: 10, writer: 4242 }))
    expect(actions.get(other)?.output).toBe('{"writer":4242}')
    const gone = new Set<number | null>()
    expect(actions.interruptRunning(20, 25, (pid) => gone.has(pid))).toBe(0)
    expect(actions.get(mine)?.status).toBe('running')
    gone.add(process.pid)
    expect(actions.interruptRunning(20, 25, (pid) => gone.has(pid))).toBe(1)
    expect(actions.get(mine)?.status).toBe('failed')
  })
})
