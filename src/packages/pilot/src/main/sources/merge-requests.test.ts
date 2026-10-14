import { describe, expect, it } from 'vitest'
import { PEOPLE, fakeGlab, sourceContext } from './__fixtures__/source-context'
import { mergeRequestSource } from './merge-requests'

type Listed = ReturnType<typeof listed>
function listed(iid: number, author: string, branch: string) {
  return {
    iid,
    title: `MR ${iid}`,
    source_branch: branch,
    target_branch: 'dev',
    author: { username: author, name: `${author} name` },
    state: 'opened',
    draft: false,
    labels: ['web'],
    reviewers: [{ username: 'nish8' }],
    web_url: `https://gitlab.com/polygenx/web-platform/-/merge_requests/${iid}`,
    sha: String(iid).repeat(10)
  }
}

type World = {
  list: Record<string, Listed[] | Error>
  pipelines?: Record<number, { id: number; status: string }>
  approvals?: Record<number, string[] | Error>
  discussions?: Record<number, unknown[] | Error>
  details?: Record<number, Error>
}

function gitlab(world: World) {
  const all = Object.values(world.list).flatMap((l) => (l instanceof Error ? [] : l))
  return fakeGlab((path) => {
    if (path === 'root:user') {
      return { username: 'nish8' }
    }
    const page = /^(merge_requests\?state=opened.*)&per_page=100&page=1$/.exec(path)
    if (page) {
      return world.list[page[1]] ?? []
    }
    const detail = /^merge_requests\/(\d+)$/.exec(path)
    if (detail) {
      const iid = Number(detail[1])
      const mr = all.find((m) => m.iid === iid)
      return (
        world.details?.[iid] ?? {
          ...mr,
          head_pipeline: world.pipelines?.[iid] ?? null,
          changes_count: '12'
        }
      )
    }
    const approvals = /^merge_requests\/(\d+)\/approvals$/.exec(path)
    if (approvals) {
      const by = world.approvals?.[Number(approvals[1])] ?? []
      return by instanceof Error ? by : { approved_by: by.map((u) => ({ user: { username: u } })) }
    }
    const threads = /^merge_requests\/(\d+)\/discussions\?per_page=100&page=1$/.exec(path)
    if (threads) {
      return world.discussions?.[Number(threads[1])] ?? []
    }
    if (path.startsWith('repository/commits/')) {
      return { committed_date: '2026-10-08T13:36:51-07:00' }
    }
    const branch = /^merge_requests\?source_branch=([^&]+)&per_page=100&page=1$/.exec(path)
    if (branch) {
      const mr = all.find((m) => m.source_branch === decodeURIComponent(branch[1]))
      return mr
        ? [
            {
              iid: mr.iid,
              state: 'opened',
              author: mr.author,
              draft: mr.draft,
              web_url: mr.web_url
            }
          ]
        : []
    }
    return undefined
  })
}

const MINE = { state: 'open', author: { people: ['nish'] } }
const REVIEW = {
  state: 'open',
  reviewer: { people: ['nish'] },
  author: { not: { people: ['nish'] } },
  approved_by: 'none'
}
const UNRESOLVED = {
  notes: [
    {
      author: { username: 'shivan2418' },
      resolvable: true,
      resolved: false,
      system: false
    }
  ]
}

describe('mergeRequestSource', () => {
  it('lists my open MRs by iid with M1 fields, the new ones and the ownership blocks', async () => {
    const api = gitlab({
      list: {
        'merge_requests?state=opened&author_username=nish8': [
          listed(1574, 'nish8', 'web-1474-show-donor'),
          listed(1561, 'nish8', 'web-1493-add-digit')
        ]
      },
      pipelines: { 1561: { id: 15610, status: 'failed' } },
      approvals: { 1574: ['alex1craig'] },
      discussions: { 1561: [UNRESOLVED] }
    })
    const { items, warnings } = await mergeRequestSource().list(sourceContext({}, api), MINE)
    expect(warnings).toEqual([])
    expect(
      items.map((i) => [
        i.key,
        i.label,
        i.fields['mr.pipeline'],
        i.fields['mr.approved_by'],
        i.fields['mr.waiting_threads'],
        i.fields['mr.review_block']
      ])
    ).toEqual([
      ['mr:1561', '!1561 web-1493-add-digit', 15610, '', 1, ''],
      [
        'mr:1574',
        '!1574 web-1474-show-donor',
        null,
        'alex1craig',
        0,
        '!1574 approved by alex1craig'
      ]
    ])
    expect(items[0].fields).toMatchObject({
      'mr.iid': 1561,
      'mr.author': 'nish8',
      'mr.author_name': 'nish8 name',
      'mr.state': 'open',
      'mr.pipeline_status': 'failed',
      'mr.head_sha': '1561156115611561156115611561156115611561',
      'mr.head_short': '15611561',
      'mr.changes_count': 12,
      'mr.reviewers': 'nish8',
      'mr.labels': 'web',
      'mr.target_branch': 'dev',
      'mr.approved_count': 0,
      'mr.owner_block': ''
    })
    expect(items[0].worktreeHint).toEqual({ branch: 'web-1493-add-digit' })
    expect(api.calls[0]).toBe(
      'merge_requests?state=opened&author_username=nish8&per_page=100&page=1'
    )
  })

  it('asks for MRs I review and reads no details for MRs the list already rules out (09)', async () => {
    const api = gitlab({
      list: {
        'merge_requests?state=opened&reviewer_username=nish8': [
          listed(1600, 'nish8', 'web-1600-mine'),
          listed(1588, 'shivan2418', 'web-2115-stop-ecs'),
          listed(1579, 'alex1craig', 'web-1579-flag')
        ]
      },
      approvals: { 1588: ['nish8'] }
    })
    const source = mergeRequestSource()
    const { items } = await source.list(sourceContext({}, api), REVIEW)
    const verdicts = items.map((i) => {
      const scope = source.scope(i, REVIEW, PEOPLE)
      return [i.key, scope.ok ? 'in' : scope.reason]
    })
    expect(verdicts).toEqual([
      ['mr:1579', 'in'],
      ['mr:1588', 'Approved by nish8'],
      ['mr:1600', 'Author is Nish Sitapara; this automation leaves out Nish Sitapara']
    ])
    expect(api.calls).not.toContain('merge_requests/1600')
  })

  it('asks GitLab per handle, URL-encoded, and lists an MR two of them review once', async () => {
    const shared = listed(1588, 'shivan2418', 'web-2115-stop-ecs')
    const api = gitlab({
      list: {
        'merge_requests?state=opened&reviewer_username=nish8': [shared],
        'merge_requests?state=opened&reviewer_username=a%20b%2Fc': [shared]
      }
    })
    const people = {
      people: [...PEOPLE.people, { id: 'odd', name: 'Odd Handle', gitlab: 'a b/c' }],
      groups: []
    }
    const where = { reviewer: { people: ['nish', 'odd'] } }
    const { items } = await mergeRequestSource().list(sourceContext({ people }, api), where)
    expect(items.map((i) => i.key)).toEqual(['mr:1588'])
    expect(api.calls.filter((c) => c.startsWith('merge_requests?state'))).toEqual([
      'merge_requests?state=opened&reviewer_username=nish8&per_page=100&page=1',
      'merge_requests?state=opened&reviewer_username=a%20b%2Fc&per_page=100&page=1'
    ])
  })

  it('makes no request when no handle resolves', async () => {
    const api = gitlab({ list: {} })
    const people = { people: [{ id: 'bot', name: 'Bot' }], groups: [] }
    const got = await mergeRequestSource().list(sourceContext({ people }, api), {
      author: { people: ['bot'] }
    })
    expect(got.items).toEqual([])
    expect(api.calls).toEqual([])
  })

  it('keeps an MR whose approvals or threads fail, with null fields and a warning each', async () => {
    const api = gitlab({
      list: {
        'merge_requests?state=opened&author_username=nish8': [listed(1561, 'nish8', 'web-1493-a')]
      },
      approvals: { 1561: new Error('glab: 500') },
      discussions: { 1561: new Error('glab: 404') }
    })
    const source = mergeRequestSource()
    const { items, warnings } = await source.list(sourceContext({}, api), MINE)
    expect(items[0].fields['mr.approved_by']).toBeNull()
    expect(items[0].fields['mr.waiting_threads']).toBeNull()
    // The two reads run side by side, so either warning may come first.
    expect([...warnings].sort()).toEqual([
      "!1561: couldn't read its approvals: glab: 500",
      "!1561: couldn't read its review threads: glab: 404"
    ])
    const scope = source.scope(items[0], { approved_by: 'none' }, PEOPLE)
    expect(scope.ok ? null : scope.reason).toBe("Approvals couldn't be read")
  })

  it.each([
    [
      'the list',
      {
        list: {
          'merge_requests?state=opened&author_username=nish8': new Error('glab: 401')
        }
      }
    ],
    [
      "an MR's details",
      {
        list: {
          'merge_requests?state=opened&author_username=nish8': [listed(1561, 'nish8', 'b')]
        },
        details: { 1561: new Error('glab: 401') }
      }
    ]
  ] as [string, World][])(
    'rejects when GitLab fails %s, so the tick fails',
    async (_name, world) => {
      const source = mergeRequestSource()
      await expect(source.list(sourceContext({}, gitlab(world)), MINE)).rejects.toThrow('glab: 401')
    }
  )

  it('shares every GitLab read between automations of one pass', async () => {
    const api = gitlab({
      list: {
        'merge_requests?state=opened&author_username=nish8': [listed(1561, 'nish8', 'web-1493-a')]
      }
    })
    const source = mergeRequestSource()
    const pass = sourceContext({}, api)
    await source.list(pass, MINE)
    await source.list(pass, { ...MINE, head_pipeline: 'failed' })
    expect(api.calls.filter((c) => c === 'merge_requests/1561')).toHaveLength(1)
    expect(new Set(api.calls).size).toBe(api.calls.length)
  })

  it('warns when a listing stopped at 1000 MRs', async () => {
    let next = 0
    const api = fakeGlab((path) =>
      path.startsWith('merge_requests?state=opened')
        ? Array.from({ length: 100 }, () => listed(++next, 'nish8', `b${next}`))
        : undefined
    )
    const { items, warnings } = await mergeRequestSource().list(sourceContext({}, api), {
      draft: true
    })
    expect(items).toHaveLength(1000)
    expect(warnings).toEqual([
      'polygenx/web-platform: stopped at 1000 open MRs (merge_requests?state=opened); later ones are not checked'
    ])
  })
})
