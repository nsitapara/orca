import { describe, expect, it } from 'vitest'
import type { RunStatus } from '../../shared/api-types'
import { PilotStore } from './store'

describe('tick state in the store', () => {
  it('remembers when each item was first seen', () => {
    const store = PilotStore.open(':memory:')
    store.markSeen('a', 'mr:1', 10)
    store.markSeen('a', 'mr:1', 20)
    store.markSeen('a', 'mr:2', 30)
    expect(store.seenTimes('a')).toEqual(
      new Map([
        ['mr:1', 10],
        ['mr:2', 30]
      ])
    )
  })

  it('lists worktrees with a running run of any automation; a run waiting on you holds no at_once slot (H2)', () => {
    const store = PilotStore.open(':memory:')
    const run = (
      id: string,
      automationId: string,
      worktreePath: string | null,
      status: RunStatus
    ) => {
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath,
        startedAt: 1
      })
      store.runs.update(id, { status })
    }
    run('a-1', 'a', '/wt/1', 'running')
    run('a-2', 'a', '/wt/4', 'needs_you')
    run('a-3', 'a', '/wt/5', 'done')
    run('b-1', 'b', '/wt/2', 'running')
    run('c-1', 'c', null, 'running')
    expect(store.runs.runningWorktreePaths()).toEqual(new Set(['/wt/1', '/wt/2']))
    expect(store.runs.runningCount('a')).toBe(1)
  })
})
