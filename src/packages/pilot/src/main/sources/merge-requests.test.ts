import { describe, expect, it } from 'vitest'
import type { GlabApi } from './gitlab-api'
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

describe('listMergeRequestItems', () => {
  it('lists open MRs by iid, fetching pipeline details only for in-scope authors', async () => {
    const api = fakeApi()
    const items = await listMergeRequestItems(api, (u) => u === 'nish8')
    expect(
      items.map((i) => [i.key, i.label, i.fields['mr.pipeline'], i.fields['mr.state']])
    ).toEqual([
      ['!1561', '!1561 web-1493', 15610, 'open'],
      ['!1574', '!1574 web-1474', 15740, 'open'],
      ['!1588', '!1588 web-2115', null, 'open']
    ])
    expect(api.calls).toEqual([
      'merge_requests?state=opened&per_page=100',
      'merge_requests/1561',
      'merge_requests/1574'
    ])
  })

  it('rejects when glab fails, so the tick fails instead of seeing no MRs', async () => {
    const api: GlabApi = {
      projectPath: 'p',
      async get() {
        throw new Error('glab: 401')
      }
    }
    await expect(listMergeRequestItems(api, () => true)).rejects.toThrow('glab: 401')
  })
})
