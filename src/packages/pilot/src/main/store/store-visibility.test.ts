import { describe, expect, it } from 'vitest'
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
})
