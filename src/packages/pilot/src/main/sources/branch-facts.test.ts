import { describe, expect, it } from 'vitest'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import { gateFields, linkFields, readBranchFacts } from './branch-facts'
import { gitlabFor } from './gitlab-fetch'

const BRANCH = 'merge_requests?source_branch=feature%2Fx&per_page=100&page=1'
const gitlabMr = (iid: number, state: string, author: string, draft = false) => ({
  iid,
  state,
  author: { username: author },
  draft,
  target_branch: 'dev',
  web_url: `https://gitlab.com/polygenx/web-platform/-/merge_requests/${iid}`
})

function routes(table: Record<string, unknown>) {
  return fakeGlab((path) => table[path])
}

describe('readBranchFacts + gateFields / linkFields', () => {
  it("reads the branch's MRs, the signed-in user and the open MR's approvals", async () => {
    const glab = routes({
      [BRANCH]: [gitlabMr(1577, 'opened', 'nish8')],
      'root:user': { username: 'nish8' },
      'merge_requests/1577/approvals': {
        approved_by: [
          { user: { username: 'jonathan.walker2' } },
          { user: { username: 'alex1craig' } }
        ]
      }
    })
    const facts = await readBranchFacts(glab, 'feature/x')
    expect(gateFields(facts)).toEqual({
      'mr.owner_block': '',
      'mr.finished_block': '',
      'mr.review_block': '!1577 approved by alex1craig, jonathan.walker2',
      'mr.draft_block': ''
    })
    expect(linkFields(facts)).toEqual({
      'mr.iid': 1577,
      'mr.state': 'open',
      'mr.author': 'nish8',
      'mr.draft': false,
      'mr.target_branch': 'dev',
      'mr.web_url': 'https://gitlab.com/polygenx/web-platform/-/merge_requests/1577',
      'mr.approved_by': 'alex1craig,jonathan.walker2',
      'mr.approved_count': 2,
      'mr.lookup_error': null
    })
  })

  it.each([
    [
      "a teammate's branch",
      { [BRANCH]: [gitlabMr(1588, 'opened', 'shivan2418')], 'merge_requests/1588/approvals': {} },
      {
        'mr.owner_block': "!1588 is shivan2418's MR",
        'mr.finished_block': '',
        'mr.review_block': "!1588 is shivan2418's MR",
        'mr.draft_block': ''
      }
    ],
    [
      'an open draft of mine',
      { [BRANCH]: [gitlabMr(1590, 'opened', 'nish8', true)], 'merge_requests/1590/approvals': {} },
      {
        'mr.owner_block': '',
        'mr.finished_block': '',
        'mr.review_block': '',
        'mr.draft_block': '!1590 is a draft'
      }
    ],
    [
      'GitLab failing to list the branch',
      { [BRANCH]: new Error('glab: 502') },
      {
        'mr.owner_block': 'MR owner unknown: glab: 502',
        'mr.finished_block': 'MR state unknown: glab: 502',
        'mr.review_block': 'MR state unknown: glab: 502',
        'mr.draft_block': 'MR draft state unknown: glab: 502'
      }
    ],
    [
      'no MR yet',
      { [BRANCH]: [] },
      { 'mr.owner_block': '', 'mr.finished_block': '', 'mr.review_block': '', 'mr.draft_block': '' }
    ]
  ])('%s', async (_name, table, want) => {
    const glab = routes({ 'root:user': { username: 'nish8' }, ...table })
    expect(gateFields(await readBranchFacts(glab, 'feature/x'))).toEqual(want)
  })

  it('keeps why the MRs were unknown on the link, and blocks everything without a GitLab project', async () => {
    const failing = routes({ [BRANCH]: new Error('glab: 502'), 'root:user': { username: 'nish8' } })
    expect(linkFields(await readBranchFacts(failing, 'feature/x'))).toMatchObject({
      'mr.iid': null,
      'mr.lookup_error': 'glab: 502'
    })
    const none = await readBranchFacts(null, 'feature/x')
    expect(gateFields(none)['mr.owner_block']).toBe(
      'MR owner unknown: no GitLab project for this repo'
    )
  })

  // gate.mr_approvers: .get("approved_by", []) then a["user"]["username"]: a list that isn't one, or an
  // approval GitLab doesn't name, is unknown, never "nobody approved".
  it.each([
    [
      'an approval that names nobody',
      { approved_by: [{ user: {} }] },
      "GitLab didn't name an approver of !1577"
    ],
    ['approved_by null', { approved_by: null }, "GitLab didn't list !1577's approvals"],
    [
      'approved_by not a list',
      { approved_by: 'alex1craig' },
      "GitLab didn't list !1577's approvals"
    ]
  ])('blocks the review on %s', async (_name, answer, error) => {
    const glab = routes({
      [BRANCH]: [gitlabMr(1577, 'opened', 'nish8')],
      'root:user': { username: 'nish8' },
      'merge_requests/1577/approvals': answer
    })
    const facts = await readBranchFacts(glab, 'feature/x')
    expect(gateFields(facts)['mr.review_block']).toBe(`MR approval unknown: ${error}`)
    expect(linkFields(facts)).toMatchObject({ 'mr.approved_by': null, 'mr.approved_count': null })
  })

  // gate.branch_mrs indexes m["iid"], m["state"] and m["web_url"]: an MR without one blocks as unknown.
  it.each([
    ['no state', { ...gitlabMr(1577, 'opened', 'nish8'), state: undefined }],
    ['no iid', { ...gitlabMr(1577, 'opened', 'nish8'), iid: '1577' }],
    ['no web URL', { ...gitlabMr(1577, 'opened', 'nish8'), web_url: undefined }]
  ])('blocks every rule when GitLab lists an MR with %s', async (_name, listed) => {
    const glab = routes({ [BRANCH]: [listed], 'root:user': { username: 'nish8' } })
    const facts = await readBranchFacts(glab, 'feature/x')
    const why = 'GitLab listed an MR from feature/x without its iid, state or web URL'
    expect(gateFields(facts)).toEqual({
      'mr.owner_block': `MR owner unknown: ${why}`,
      'mr.finished_block': `MR state unknown: ${why}`,
      'mr.review_block': `MR state unknown: ${why}`,
      'mr.draft_block': `MR draft state unknown: ${why}`
    })
  })

  it('pages the branch listing, and blocks when it stops at 1000 MRs', async () => {
    let next = 0
    const glab = fakeGlab((path) => {
      if (path === 'root:user') {
        return { username: 'nish8' }
      }
      return Array.from({ length: 100 }, () => gitlabMr(++next, 'merged', 'nish8'))
    })
    const facts = await readBranchFacts(glab, 'feature/x')
    expect(glab.calls.filter((c) => c.startsWith('merge_requests?'))).toHaveLength(10)
    expect(gateFields(facts)['mr.finished_block']).toBe(
      'MR state unknown: GitLab lists 1000+ MRs from feature/x; not all were read'
    )
  })

  it("names GitLab's failure to name me on the link, whose owner it ranked without me", async () => {
    const glab = routes({
      [BRANCH]: [gitlabMr(1393, 'merged', 'nish8'), gitlabMr(1453, 'merged', 'alex1craig')],
      'root:user': new Error('glab: 401')
    })
    expect(linkFields(await readBranchFacts(glab, 'feature/x'))).toMatchObject({
      'mr.iid': 1453,
      'mr.lookup_error': 'glab: 401'
    })
  })

  it('asks for the signed-in user once per pass, however many branches', async () => {
    const glab = fakeGlab((path) => (path === 'root:user' ? { username: 'nish8' } : []))
    const api = await gitlabFor(sourceContext({}, glab))
    await readBranchFacts(api, 'a')
    await readBranchFacts(api, 'b')
    expect(glab.calls.filter((c) => c === 'root:user')).toHaveLength(1)
  })
})
