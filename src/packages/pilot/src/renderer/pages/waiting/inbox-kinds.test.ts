import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import { emptyInboxText, INBOX_KINDS, kindCounts, matchesFilters } from './inbox-kinds'

function card(over: Partial<InboxListRow> = {}): InboxListRow {
  return {
    id: 'in_1',
    automationId: 'ci',
    runId: 'r',
    stepIdx: 0,
    itemKey: 'mr:1',
    worktreePath: '/wt/web-1493',
    person: 'nish',
    type: 'question',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    digest: 'd',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  }
}

describe('matchesFilters', () => {
  it('filters by kind', () => {
    const item = card({ title: 'Which Carrier?' })
    expect(matchesFilters(item, { kinds: ['bug'] })).toBe(false)
    expect(matchesFilters(item, { kinds: ['bug', 'question'] })).toBe(true)
    expect(matchesFilters(item, { kinds: [] })).toBe(true)
  })
})

describe('emptyInboxText', () => {
  it.each([
    ['a picked kind', true, 'No cards match these filters.'],
    ['no kind picked', false, 'Nothing waiting on Nish here.']
  ] as const)('names %s', (_case, filtered, want) => {
    expect(emptyInboxText(filtered, 'Nish')).toBe(want)
  })
})

describe('kindCounts and INBOX_KINDS', () => {
  it('counts per kind and lists the kinds in display order', () => {
    expect(kindCounts([card(), card({ id: 'b' }), card({ id: 'c', type: 'bug' })])).toEqual({
      question: 2,
      bug: 1
    })
    expect(INBOX_KINDS.map((k) => k.label)).toEqual([
      'Questions',
      'Approvals',
      'Bugs',
      'Flagged',
      'Left for you'
    ])
  })
})
