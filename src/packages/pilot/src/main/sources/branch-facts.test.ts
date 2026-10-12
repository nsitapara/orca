import { describe, expect, it } from 'vitest'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import { gateFields, linkFields, readBranchFacts } from './branch-facts'
import { gitlabFor } from './gitlab-fetch'

const BRANCH = 'merge_requests?source_branch=feature%2Fx&per_page=100'
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

  // gate.mr_approvers reads a["user"]["username"]: an approval GitLab doesn't name is unknown, not none.
  it('blocks the review when an approval names nobody', async () => {
    const glab = routes({
      [BRANCH]: [gitlabMr(1577, 'opened', 'nish8')],
      'root:user': { username: 'nish8' },
      'merge_requests/1577/approvals': { approved_by: [{ user: {} }] }
    })
    const facts = await readBranchFacts(glab, 'feature/x')
    expect(gateFields(facts)['mr.review_block']).toBe(
      "MR approval unknown: GitLab didn't name an approver of !1577"
    )
    expect(linkFields(facts)).toMatchObject({ 'mr.approved_by': null, 'mr.approved_count': null })
  })

  it('asks for the signed-in user once per pass, however many branches', async () => {
    const glab = fakeGlab((path) => (path === 'root:user' ? { username: 'nish8' } : []))
    const api = await gitlabFor(sourceContext({}, glab))
    await readBranchFacts(api, 'a')
    await readBranchFacts(api, 'b')
    expect(glab.calls.filter((c) => c === 'root:user')).toHaveLength(1)
  })
})
