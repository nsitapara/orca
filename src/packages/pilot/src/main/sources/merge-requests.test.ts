import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlabApi } from './gitlab-api'
import type { PeopleRef } from '../../shared/definition/types'
import { gitlabHandlesFor, type PeopleDirectory } from '../../shared/people'
import { listMergeRequestItems } from './merge-requests'

function fakeApi(): GlabApi & { calls: string[] } {
  const calls: string[] = []
  const list = [
    {
      iid: 1574,
      title: 'Donor status',
      source_branch: 'web-1474-show-donor',
      author: { username: 'nish8' },
      state: 'opened',
      draft: false
    },
    {
      iid: 1561,
      title: 'Digit format',
      source_branch: 'web-1493-add-digit',
      author: { username: 'nish8' },
      state: 'opened',
      draft: false
    },
    {
      iid: 1588,
      title: 'ECS deps',
      source_branch: 'web-2115-stop-ecs',
      author: { username: 'shivan2418' },
      state: 'opened',
      draft: false
    }
  ]
  return {
    calls,
    projectPath: 'polygenx/web-platform',
    async get<T>(path: string): Promise<T> {
      calls.push(path)
      if (path.startsWith('merge_requests?')) {
        return list as T
      }
      const iid = Number(path.split('/')[1])
      return {
        ...list.find((m) => m.iid === iid),
        head_pipeline: { id: iid * 10, status: 'failed' }
      } as T
    }
  }
}

const nish = {
  authorUsernames: ['nish8'],
  inScope: (u: string) => u === 'nish8'
}

function mr(iid: number, author: string) {
  return {
    iid,
    title: `MR ${iid}`,
    source_branch: `web-${iid}-x`,
    author: { username: author },
    state: 'opened'
  }
}

// Serves list requests from `byQuery(path)`; detail requests echo the iid with a pipeline.
function pagedApi(byQuery: (path: string) => unknown[]): GlabApi & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    projectPath: 'p',
    async get<T>(path: string): Promise<T> {
      calls.push(path)
      if (path.startsWith('merge_requests?')) {
        return byQuery(path) as T
      }
      const iid = Number(path.split('/')[1])
      return {
        ...mr(iid, 'x'),
        head_pipeline: { id: iid, status: 'failed' }
      } as T
    }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('listMergeRequestItems', () => {
  it('lists open MRs by iid with pipeline details, dropping out-of-scope authors', async () => {
    const api = fakeApi()
    const items = await listMergeRequestItems(api, {
      authorUsernames: null,
      inScope: (u) => u === 'nish8'
    })
    expect(
      items.map((i) => [i.key, i.label, i.fields['mr.pipeline'], i.fields['mr.state']])
    ).toEqual([
      ['!1561', '!1561 web-1493', 15610, 'open'],
      ['!1574', '!1574 web-1474', 15740, 'open']
    ])
    expect(api.calls).toEqual([
      'merge_requests?state=opened&per_page=100&page=1',
      'merge_requests/1561',
      'merge_requests/1574'
    ])
  })

  it('asks GitLab per handle (URL-encoded), merges the results and de-duplicates by iid', async () => {
    const api = pagedApi((path) =>
      path.includes('author_username=nish8') ? [mr(2, 'nish8'), mr(1, 'nish8')] : [mr(2, 'nish8')]
    )
    const items = await listMergeRequestItems(api, {
      authorUsernames: ['nish8', 'a b/c'],
      inScope: () => true
    })
    expect(items.map((i) => i.key)).toEqual(['!1', '!2'])
    expect(api.calls.filter((c) => c.startsWith('merge_requests?'))).toEqual([
      'merge_requests?state=opened&author_username=nish8&per_page=100',
      'merge_requests?state=opened&author_username=a%20b%2Fc&per_page=100'
    ])
  })

  it('makes no request and returns nothing when no handle resolves', async () => {
    const api = pagedApi(() => [mr(1, 'x')])
    expect(
      await listMergeRequestItems(api, {
        authorUsernames: [],
        inScope: () => true
      })
    ).toEqual([])
    expect(api.calls).toEqual([])
  })

  it('still drops returned MRs whose author is out of scope', async () => {
    const api = pagedApi(() => [mr(1, 'nish8'), mr(2, 'other')])
    const items = await listMergeRequestItems(api, {
      ...nish,
      inScope: (u) => u === 'nish8'
    })
    expect(items.map((i) => i.key)).toEqual(['!1'])
  })

  it('without an author filter, pages until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => mr(i + 1, 'a'))
    const api = pagedApi((path) => (path.endsWith('page=1') ? full : [mr(101, 'a')]))
    const items = await listMergeRequestItems(api, {
      authorUsernames: null,
      inScope: () => true
    })
    expect(items).toHaveLength(101)
    expect(api.calls.filter((c) => c.startsWith('merge_requests?'))).toEqual([
      'merge_requests?state=opened&per_page=100&page=1',
      'merge_requests?state=opened&per_page=100&page=2'
    ])
  })

  it('stops at 10 pages and logs that it capped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let next = 0
    const api = pagedApi(() => Array.from({ length: 100 }, () => mr(++next, 'a')))
    const items = await listMergeRequestItems(api, {
      authorUsernames: null,
      inScope: () => true
    })
    expect(items).toHaveLength(1000)
    expect(api.calls.filter((c) => c.startsWith('merge_requests?'))).toHaveLength(10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1000'))
  })

  it('rejects when glab fails, so the tick fails instead of seeing no MRs', async () => {
    const api: GlabApi = {
      projectPath: 'p',
      async get() {
        throw new Error('glab: 401')
      }
    }
    await expect(
      listMergeRequestItems(api, {
        authorUsernames: null,
        inScope: () => true
      })
    ).rejects.toThrow('glab: 401')
    await expect(listMergeRequestItems(api, nish)).rejects.toThrow('glab: 401')
  })
})

describe('gitlabHandlesFor', () => {
  const dir: PeopleDirectory = {
    people: [
      { id: 'nish', name: 'Nish', gitlab: 'nish8' },
      { id: 'sam', name: 'Sam', gitlab: 'sam1' },
      { id: 'bot', name: 'Bot' }
    ],
    groups: [{ id: 'eng', name: 'Eng', members: ['sam', 'bot', 'nish'] }]
  }
  it.each([
    ['anyone', null],
    [undefined, null],
    [{ people: ['nish'] }, ['nish8']],
    [{ people: ['bot'] }, []],
    [{ group: 'eng' }, ['nish8', 'sam1']],
    [{ people: ['nish'], group: 'eng' }, ['nish8', 'sam1']],
    [{ group: 'missing' }, []]
  ] as const)('%j -> %j', (ref, expected) => {
    expect(gitlabHandlesFor(ref as PeopleRef | undefined, dir)).toEqual(expected)
  })
})
