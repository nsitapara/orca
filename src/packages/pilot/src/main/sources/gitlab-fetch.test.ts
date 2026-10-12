import { describe, expect, it } from 'vitest'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import { gitlabFor, pageAll } from './gitlab-fetch'

describe('gitlabFor', () => {
  it("is the pass's one client for the repo, so a path is asked once per pass", async () => {
    const glab = fakeGlab(() => ({ ok: 1 }))
    const ctx = sourceContext({}, glab)
    const one = await gitlabFor(ctx)
    const two = await gitlabFor(ctx)
    await one.get('merge_requests/1')
    await two.get('merge_requests/1')
    const next = await gitlabFor(sourceContext({}, glab))
    await next.get('merge_requests/1')
    expect(glab.calls).toEqual(['merge_requests/1', 'merge_requests/1'])
  })
})

describe('pageAll (gate.glab_all)', () => {
  it('pages by 100 until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => i)
    const api = fakeGlab((path) => (path.endsWith('page=1') ? full : [100]))
    const got = await pageAll<number>(sourceContext(), api, 'merge_requests?state=opened')
    expect(got).toEqual({ items: [...full, 100], capped: false })
    expect(api.calls).toEqual([
      'merge_requests?state=opened&per_page=100&page=1',
      'merge_requests?state=opened&per_page=100&page=2'
    ])
  })

  it('starts the query with ? on a path without one', async () => {
    const api = fakeGlab(() => [])
    await pageAll(sourceContext(), api, 'merge_requests/7/discussions')
    expect(api.calls).toEqual(['merge_requests/7/discussions?per_page=100&page=1'])
  })

  it('stops after 10 full pages and says it capped', async () => {
    const api = fakeGlab(() => Array.from({ length: 100 }, (_, i) => i))
    const got = await pageAll<number>(sourceContext(), api, 'merge_requests?state=opened')
    expect(got.items).toHaveLength(1000)
    expect(got.capped).toBe(true)
    expect(api.calls).toHaveLength(10)
  })

  it('reads the whole listing once per pass', async () => {
    const api = fakeGlab(() => [1, 2])
    const ctx = sourceContext()
    await pageAll(ctx, api, 'merge_requests?state=opened')
    await pageAll(ctx, api, 'merge_requests?state=opened')
    expect(api.calls).toHaveLength(1)
  })
})
