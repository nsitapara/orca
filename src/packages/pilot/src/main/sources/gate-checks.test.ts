import { describe, expect, it } from 'vitest'
import { mrOutcome, type MrRule } from '../../shared/tick/checks-gate'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import { gateFields, readBranchFacts } from './branch-facts'
import { gitlabFor } from './gitlab-fetch'

const BRANCH = 'merge_requests?source_branch=feature%2Fx&per_page=100&page=1'
const mr = (iid: number, state: string, author: string, draft = false) => ({
  iid,
  state,
  author: { username: author },
  draft,
  target_branch: 'dev',
  web_url: `https://gitlab.com/polygenx/web-platform/-/merge_requests/${iid}`
})
const RULES: MrRule[] = ['not_approved', 'not_merged', 'mine', 'not_draft']

describe('mr checks end to end (gate.review_block, mr_block, owner_block)', () => {
  it.each([
    ['my open MR, nobody approved', [mr(1577, 'opened', 'nish8')], {}, [null, null, null, null]],
    [
      "a teammate's MR",
      [mr(1588, 'opened', 'shivan2418')],
      {},
      ["!1588 is shivan2418's MR", null, "!1588 is shivan2418's MR", null]
    ],
    [
      'approved',
      [mr(1577, 'opened', 'nish8')],
      { 1577: ['alex1craig', 'jonathan.walker2'] },
      ['!1577 approved by alex1craig, jonathan.walker2', null, null, null]
    ],
    [
      "an old merged MR's approval doesn't count",
      [mr(1393, 'merged', 'nish8'), mr(1577, 'opened', 'nish8')],
      { 1393: ['alex1craig'] },
      [null, null, null, null]
    ],
    [
      'merged wins',
      [mr(1453, 'merged', 'nish8')],
      { 1453: ['alex1craig'] },
      ['!1453 merged', '!1453 merged', null, null]
    ],
    ['no MR yet', [], {}, [null, null, null, null]],
    [
      'an open draft',
      [mr(1590, 'opened', 'nish8', true)],
      {},
      [null, null, null, '!1590 is a draft']
    ],
    [
      'GitLab failing',
      new Error('glab exited 1'),
      {},
      [
        'MR state unknown: glab exited 1',
        'MR state unknown: glab exited 1',
        'MR owner unknown: glab exited 1',
        'MR draft state unknown: glab exited 1'
      ]
    ]
  ] as [string, unknown[] | Error, Record<number, string[]>, (string | null)[]][])(
    '%s',
    async (_name, mrs, approvals, want) => {
      const glab = fakeGlab((path) => {
        if (path === 'root:user') {
          return { username: 'nish8' }
        }
        if (path === BRANCH) {
          return mrs
        }
        const iid = /^merge_requests\/(\d+)\/approvals$/.exec(path)?.[1]
        if (iid) {
          return {
            approved_by: (approvals[Number(iid)] ?? []).map((u) => ({ user: { username: u } }))
          }
        }
        return undefined
      })
      const fields = gateFields(
        await readBranchFacts(await gitlabFor(sourceContext({}, glab)), 'feature/x')
      )
      const got = RULES.map((rule) => {
        const outcome = mrOutcome(rule, fields)
        return outcome.ok ? null : outcome.reason
      })
      expect(got).toEqual(want)
    }
  )
})
