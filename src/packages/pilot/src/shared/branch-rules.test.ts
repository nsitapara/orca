import { describe, expect, it } from 'vitest'
import {
  draftBlock,
  finishedBlock,
  known,
  notKnown,
  ownerBlock,
  reviewBlock,
  type BranchMrFact,
  type Known
} from './branch-rules'

const mr = (
  iid: number,
  state: string,
  author: string | null = 'nish8',
  draft = false
): BranchMrFact => ({
  iid,
  state,
  author,
  draft
})
const ME = known('nish8')

describe('finishedBlock (gate.mr_block)', () => {
  it.each([
    ['no MR yet', [], null],
    ['open', [mr(1453, 'opened')], null],
    ['an older merged MR and a new open one', [mr(1393, 'merged'), mr(1453, 'opened')], null],
    ['merged', [mr(1453, 'merged'), mr(1393, 'merged')], '!1453 merged'],
    ['closed', [mr(1460, 'closed')], '!1460 closed'],
    ['locked', [mr(1470, 'locked')], null]
  ] as [string, BranchMrFact[], string | null][])('%s', (_name, mrs, want) => {
    expect(finishedBlock(known(mrs))).toBe(want)
  })

  it('GitLab failing blocks the branch', () => {
    expect(finishedBlock(notKnown('glab exited 1'))).toBe('MR state unknown: glab exited 1')
  })
})

describe('ownerBlock (gate.owner_block)', () => {
  it.each([
    ['my MR', known([mr(1587, 'opened')]), ME, null],
    ['no MR yet', known([]), ME, null],
    ["a teammate's MR", known([mr(1588, 'opened', 'shivan2418')]), ME, "!1588 is shivan2418's MR"],
    [
      'the open MR decides over a newer closed one',
      known([mr(1588, 'opened', 'shivan2418'), mr(1600, 'closed', 'jon')]),
      ME,
      "!1588 is shivan2418's MR"
    ],
    [
      "a teammate's open MR from a branch I opened an MR from",
      known([mr(1393, 'merged'), mr(1453, 'opened', 'alex1craig')]),
      ME,
      "!1453 is alex1craig's MR"
    ],
    [
      'with none open, an MR I opened keeps it mine',
      known([mr(1393, 'merged'), mr(1453, 'merged', 'alex1craig')]),
      ME,
      null
    ],
    ['GitLab failing', notKnown('glab exited 1'), ME, 'MR owner unknown: glab exited 1'],
    [
      'no author named',
      known([mr(1588, 'opened', null)]),
      ME,
      "MR owner unknown: GitLab didn't name !1588's author"
    ],
    ['GitLab cannot name me', known([]), notKnown('401'), 'MR owner unknown: 401']
  ] as [string, Known<BranchMrFact[]>, Known<string>, string | null][])(
    '%s',
    (_name, mrs, me, want) => {
      expect(ownerBlock(mrs, me)).toBe(want)
    }
  )
})

describe('reviewBlock (gate.review_block)', () => {
  const approvals =
    (by: Record<number, string[] | Error>) =>
    (iid: number): Known<string[]> => {
      const found = by[iid] ?? []
      return found instanceof Error ? notKnown(found.message) : known(found)
    }
  it.each([
    ['open, nobody approved', [mr(1577, 'opened')], { 1577: [] }, null],
    [
      "a teammate's MR",
      [mr(1588, 'opened', 'shivan2418')],
      { 1588: [] },
      "!1588 is shivan2418's MR"
    ],
    [
      'open, approved',
      [mr(1577, 'opened')],
      { 1577: ['alex1craig', 'jonathan.walker2'] },
      '!1577 approved by alex1craig, jonathan.walker2'
    ],
    [
      "an old merged MR's approval doesn't count",
      [mr(1393, 'merged'), mr(1577, 'opened')],
      { 1393: ['alex1craig'], 1577: [] },
      null
    ],
    ['merged wins', [mr(1453, 'merged')], { 1453: ['alex1craig'] }, '!1453 merged'],
    [
      'approvals unknown',
      [mr(1577, 'opened')],
      { 1577: new Error('glab exited 1') },
      'MR approval unknown: glab exited 1'
    ]
  ] as [string, BranchMrFact[], Record<number, string[] | Error>, string | null][])(
    '%s',
    (_name, mrs, by, want) => {
      expect(reviewBlock(known(mrs), ME, approvals(by))).toBe(want)
    }
  )
})

describe('draftBlock', () => {
  it.each([
    ['an open draft', known([mr(1590, 'opened', 'nish8', true)]), '!1590 is a draft'],
    ['a merged draft', known([mr(1590, 'merged', 'nish8', true)]), null],
    ['not a draft', known([mr(1590, 'opened')]), null],
    ['GitLab failing', notKnown('glab exited 1'), 'MR draft state unknown: glab exited 1']
  ] as [string, Known<BranchMrFact[]>, string | null][])('%s', (_name, mrs, want) => {
    expect(draftBlock(mrs)).toBe(want)
  })
})
