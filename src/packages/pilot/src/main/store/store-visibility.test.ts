import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision } from '../../shared/api-types'
import { PilotStore } from './store'

function decision(key: string, fields: Record<string, string>): ItemDecision {
  return { key, label: key, verdict: 'started', reason: '', checks: [], onceKey: key, fields }
}

describe('VisibilityStore.recentLinearUrls', () => {
  it('returns the URLs of the newest tick item that has a Linear issue URL, else []', () => {
    const store = PilotStore.open(':memory:')
    expect(store.visibility.recentLinearUrls()).toEqual([])
    const old = store.startTick('a', 1)
    store.recordDecisions(
      old,
      [decision('WEB-1', { 'ticket.url': 'https://linear.app/old/issue/WEB-1/x' })],
      new Map()
    )
    const recent = store.startTick('a', 2)
    store.recordDecisions(
      recent,
      [
        decision('WEB-2', {
          'ticket.url': 'https://linear.app/new/issue/WEB-2/y',
          'ticket.id': 'WEB-2'
        })
      ],
      new Map()
    )
    store.recordDecisions(
      store.startTick('b', 3),
      [decision('!1', { 'mr.web_url': 'https://gitlab.com/g/p/-/merge_requests/1' })],
      new Map()
    )
    expect(store.visibility.recentLinearUrls()).toEqual(['https://linear.app/new/issue/WEB-2/y'])
    store.close()
  })

  it('skips a newer row that only mentions a Linear URL, and a corrupt one', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-visibility-')), 'db.sqlite')
    const store = PilotStore.open(path)
    const good = 'https://linear.app/x/issue/WEB-1/y'
    store.recordDecisions(
      store.startTick('a', 1),
      [decision('WEB-1', { 'ticket.url': good })],
      new Map()
    )
    store.recordDecisions(
      store.startTick('a', 2),
      [decision('N', { note: 'see https://linear.app/x/issue/WEB-9/y please' })],
      new Map()
    )
    expect(store.visibility.recentLinearUrls()).toEqual([good])
    store.recordDecisions(
      store.startTick('a', 3),
      [decision('C', { note: 'linear.app/x/issue/' })],
      new Map()
    )
    const raw = new Database(path)
    raw
      .prepare(
        "UPDATE tick_items SET fields_json = 'linear.app/x/issue/ not json' WHERE item_key = 'C'"
      )
      .run()
    raw.close()
    expect(store.visibility.recentLinearUrls()).toEqual([good])
    store.close()
  })
})

describe('VisibilityStore acknowledgements', () => {
  it('lists ended runs nobody acknowledged since a time, newest first, and acknowledges them', () => {
    const store = PilotStore.open(':memory:')
    const add = (
      id: string,
      automationId: string,
      status: 'done' | 'running' | 'failed',
      finishedAt: number | null
    ) => {
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt: 1,
        status
      })
      if (finishedAt !== null) {
        store.runs.update(id, { finishedAt })
      }
    }
    add('old', 'a', 'done', 5)
    add('one', 'a', 'done', 20)
    add('two', 'b', 'failed', 30)
    add('live', 'a', 'running', null)
    expect(store.visibility.unacknowledged(null, 10, 50).map((r) => r.id)).toEqual(['two', 'one'])
    expect(store.visibility.unacknowledged(['a'], 10, 50).map((r) => r.id)).toEqual(['one'])
    expect(store.visibility.acknowledge(['live'], 98)).toEqual([])
    expect(store.visibility.acknowledge(['one', 'nope'], 99)).toEqual(['one'])
    expect(store.visibility.acknowledge(['one'], 100)).toEqual([])
    expect(store.runs.get('one')?.acknowledgedAt).toBe(99)
    expect(store.visibility.unacknowledged(null, 10, 50).map((r) => r.id)).toEqual(['two'])
    store.close()
  })
})
