import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../shared/api-types'
import type { InboxGroupBy, InboxSort } from '../pages/waiting/inbox-view-prefs'
import { LOCAL_NAMED, MINI } from './__fixtures__/hosts'
import { inboxRow } from './__fixtures__/inbox-row'
import { groupHostedItemsBy } from './inbox-grouping'
import type { Hosted } from './pilot-host'

const NOW = 1_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const AUTOMATIONS = [
  { id: 'review', name: '10 Review' },
  { id: 'ci', name: '2 Fix CI' }
]

function card(
  id: string,
  worktreePath: string,
  automationId: string,
  type: InboxListRow['type'],
  age: number
): Hosted<InboxListRow> {
  return {
    ...inboxRow({ id, worktreePath, automationId, type, createdAt: NOW - age }),
    host: LOCAL_NAMED
  }
}

const ITEMS = [
  card('a', '/w/x', 'review', 'question', 30 * MIN),
  card('b', '/w/x', 'ci', 'action', 2 * HOUR),
  card('c', '/w/y', 'review', 'bug', 30 * HOUR),
  card('d', '/w/y', 'ci', 'question', 3 * DAY),
  card('e', '/w/z', 'review', 'action', 8 * DAY),
  card('f', '/w/z', 'ci', 'bug', 10 * DAY)
]

function run(group: InboxGroupBy, sort: InboxSort, items = ITEMS) {
  return groupHostedItemsBy(items, AUTOMATIONS, group, sort, NOW).map((s) => [
    s.group.label,
    s.items.map((i) => i.id)
  ])
}

describe('groupHostedItemsBy', () => {
  it.each([
    [
      'worktree',
      [
        ['x', ['a', 'b']],
        ['y', ['d', 'c']],
        ['z', ['e', 'f']]
      ]
    ],
    [
      'job',
      [
        ['2 Fix CI', ['d', 'b', 'f']],
        ['10 Review', ['a', 'e', 'c']]
      ]
    ],
    [
      'kind',
      [
        ['Questions', ['d', 'a']],
        ['Approvals', ['e', 'b']],
        ['Bugs', ['f', 'c']]
      ]
    ],
    [
      'age',
      [
        ['Last hour', ['a']],
        ['Today', ['b']],
        ['This week', ['d', 'c']],
        ['Older', ['e', 'f']]
      ]
    ],
    ['none', [['', ['d', 'a', 'e', 'b', 'f', 'c']]]]
  ] as const)('groups by %s in its section order', (group, expected) => {
    expect(run(group, 'kind')).toEqual(expected)
  })

  it.each([
    ['oldest', ['f', 'e', 'd', 'c', 'b', 'a']],
    ['newest', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['kind', ['d', 'a', 'e', 'b', 'f', 'c']]
  ] as const)('sorts cards %s inside a section', (sort, ids) => {
    expect(run('none', sort)).toEqual([['', ids]])
  })

  it('orders kind sections like the inbox: question, flagged, action, bug, left for you', () => {
    const kinds = [
      card('l', '/w/x', 'ci', 'left_for_you', 1),
      card('b', '/w/x', 'ci', 'bug', 2),
      card('a', '/w/x', 'ci', 'action', 3),
      card('f', '/w/x', 'ci', 'flagged', 4),
      card('q', '/w/x', 'ci', 'question', 5)
    ]
    expect(run('kind', 'kind', kinds).map(([label]) => label)).toEqual([
      'Questions',
      'Flagged',
      'Approvals',
      'Bugs',
      'Left for you'
    ])
  })

  it('breaks a created-at tie by id', () => {
    const tied = [card('q', '/w/x', 'ci', 'bug', 5), card('p', '/w/x', 'ci', 'bug', 5)]
    expect(run('none', 'newest', tied)).toEqual([['', ['p', 'q']]])
  })

  it('gives only worktree sections a worktree key, so other headings render no link', () => {
    const keys = (g: InboxGroupBy) =>
      groupHostedItemsBy(ITEMS, AUTOMATIONS, g, 'kind', NOW).map((s) =>
        s.group.key.startsWith('wt:')
      )
    expect(keys('worktree')).toEqual([true, true, true])
    for (const g of ['job', 'kind', 'age', 'none'] as const) {
      expect(keys(g).some(Boolean)).toBe(false)
    }
  })

  it('keeps the same id on two machines as two cards in two sections', () => {
    const twin = { ...card('a', '/w/x', 'ci', 'bug', MIN), host: MINI }
    const sections = groupHostedItemsBy(
      [card('a', '/w/x', 'ci', 'bug', MIN), twin],
      AUTOMATIONS,
      'kind',
      'kind',
      NOW
    )
    expect(sections.map((s) => [s.host.key, s.items.map((i) => i.id)])).toEqual([
      ['local', ['a']],
      ['env:mini', ['a']]
    ])
    expect(new Set(sections.map((s) => s.key)).size).toBe(2)
  })
})
