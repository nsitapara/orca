import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from './api-types'
import { groupItems, groupOf, KIND_ORDER } from './inbox-groups'

const AUTOMATIONS = [
  { id: 'review-requests', name: '09 · Prepare reviews requested of me' },
  { id: 'docker-prune', name: 'Docker prune' }
]
type Key = Pick<InboxItemRow, 'itemKey' | 'worktreePath' | 'automationId'>
const of = (
  itemKey: string | null,
  worktreePath: string | null,
  automationId = 'review-requests'
) => ({ itemKey, worktreePath, automationId }) satisfies Key

describe('groupOf', () => {
  it.each([
    [
      'the worktree path',
      of('mr:1', '/Users/n/wt/web-2099-carrier'),
      'wt:/Users/n/wt/web-2099-carrier',
      'web-2099-carrier'
    ],
    [
      'the path in a wt: key',
      of('wt:repo-1::/Users/n/wt/web-2118-x/', null),
      'wt:/Users/n/wt/web-2118-x',
      'web-2118-x'
    ],
    ['an MR', of('mr:1579', null), 'mr:1579', '!1579'],
    ['a dev pipeline', of('pipeline:98765', null), 'pipeline:dev', 'dev pipeline'],
    [
      'a pipeline that names its ref',
      of('pipeline:release-1', null),
      'pipeline:release-1',
      'release-1 pipeline'
    ],
    ['a Linear ticket', of('linear:WEB-2118', null), 'linear:WEB-2118', 'WEB-2118'],
    [
      'no item: the job’s name',
      of(null, null),
      'job:review-requests',
      '09 · Prepare reviews requested of me'
    ],
    ['no item: an unknown job’s id', of(null, null, 'mystery'), 'job:mystery', 'mystery'],
    ['docker-prune', of(null, null, 'docker-prune'), 'cleanup', 'Clean up'],
    [
      'a wt: key without a path, to the job',
      of('wt:repo-1', null),
      'job:review-requests',
      '09 · Prepare reviews requested of me'
    ],
    [
      'a wt: key with an empty path, to the job',
      of('wt:repo-1::', null),
      'job:review-requests',
      '09 · Prepare reviews requested of me'
    ],
    [
      'an mr: key without an iid, to the job',
      of('mr:', null),
      'job:review-requests',
      '09 · Prepare reviews requested of me'
    ],
    [
      'a key of no known kind, to the job',
      of('iid:5', null),
      'job:review-requests',
      '09 · Prepare reviews requested of me'
    ]
  ])('groups by %s', (_name, item, key, label) => {
    const g = groupOf(item, AUTOMATIONS)
    expect([g.key, g.label]).toEqual([key, label])
  })

  it('never calls anything Job-wide', () => {
    expect(groupOf(of(null, null, 'x'), []).label).not.toBe('Job-wide')
  })
})

function row(id: string, type: InboxItemRow['type'], createdAt: number, k: Key): InboxItemRow {
  return { id, type, createdAt, ...k } as InboxItemRow
}

describe('an MR group’s name', () => {
  const mr = (itemLabel?: string) => ({
    ...of('mr:1571', null),
    ...(itemLabel === undefined ? {} : { itemLabel })
  })
  it.each([
    ['a run label', '!1571 web-2107-improve-reports', '!1571 · web-2107-improve-reports'],
    ['a label without the iid', 'web-2107 improve', '!1571 · web-2107 improve'],
    ['only the iid', '!1571', '!1571'],
    ['nothing known', undefined, '!1571'],
    ['an empty label', '  ', '!1571']
  ])('from %s', (_n, label, want) => {
    expect(groupOf(mr(label), AUTOMATIONS).label).toBe(want)
  })

  it('takes the name from the first card of the group that has one', () => {
    const out = groupItems(
      [
        row('a', 'action', 1, mr()),
        row('b', 'action', 2, mr('!1571 web-x')),
        row('c', 'action', 3, mr('!1571 web-y'))
      ],
      AUTOMATIONS
    )
    expect(out.map((s) => [s.group.key, s.group.label])).toEqual([['mr:1571', '!1571 · web-x']])
  })
})

describe('groupItems', () => {
  it('sorts interleaved cards into sections: worktrees, MRs, pipelines, tickets, jobs, Clean up last', () => {
    const items = [
      row('clean', 'default', 1, of(null, null, 'docker-prune')),
      row('job', 'question', 2, of(null, null)),
      row('ticket', 'action', 3, of('linear:WEB-1', null)),
      row('pipe', 'action', 4, of('pipeline:1', null)),
      row('mr', 'action', 5, of('mr:1579', null)),
      row('b-late', 'bug', 9, of('wt:r::/w/web-b', null)),
      row('a-left', 'left_for_you', 2, of('mr:1', '/w/web-a')),
      row('mr2', 'action', 6, of('mr:1579', null)),
      row('a-q', 'question', 8, of('mr:1', '/w/web-a')),
      row('a-left-old', 'left_for_you', 1, of('mr:1', '/w/web-a'))
    ]
    const out = groupItems(items, AUTOMATIONS)
    expect(out.map((s) => [s.group.label, s.items.map((i) => i.id)])).toEqual([
      ['web-a', ['a-q', 'a-left-old', 'a-left']],
      ['web-b', ['b-late']],
      ['!1579', ['mr', 'mr2']],
      ['dev pipeline', ['pipe']],
      ['WEB-1', ['ticket']],
      ['09 · Prepare reviews requested of me', ['job']],
      ['Clean up', ['clean']]
    ])
  })

  it('puts an MR card in the worktree another card of that MR is known to have', () => {
    const out = groupItems(
      [
        row('with', 'action', 1, of('mr:7', '/w/web-7')),
        row('without', 'action', 2, of('mr:7', null))
      ],
      AUTOMATIONS
    )
    expect(out.map((s) => [s.group.label, s.items.map((i) => i.id)])).toEqual([
      ['web-7', ['with', 'without']]
    ])
  })

  it('orders kinds as the console does', () => {
    expect(KIND_ORDER).toEqual(['question', 'flagged', 'action', 'bug', 'left_for_you', 'default'])
  })
})

describe('a worktree group’s id hint', () => {
  it('comes from a wt: item key, and reaches the section even when another card named the path', () => {
    const out = groupItems(
      [
        row('a', 'bug', 1, of('mr:1', '/w/web-5')),
        row('b', 'bug', 2, of('wt:repo-2::/w/web-5', null))
      ],
      AUTOMATIONS
    )
    expect(out).toHaveLength(1)
    expect(out[0].group).toMatchObject({ key: 'wt:/w/web-5', worktreeId: 'repo-2::/w/web-5' })
    expect(groupOf(of('mr:1', '/w/web-5'), AUTOMATIONS).worktreeId).toBeUndefined()
  })
})
