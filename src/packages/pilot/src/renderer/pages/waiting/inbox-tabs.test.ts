import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import type { PreparationRef } from '../../../shared/preparation'
import { waitingCount } from './answer-text'
import { INBOX_KINDS, inTab, kindCounts, matchesFilters, tabCounts } from './inbox-tabs'

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

function prepared(state: PreparationRef['state'] | null): Partial<InboxListRow> {
  if (state === null) {
    return {}
  }
  return {
    preparation: {
      state,
      revision: 1,
      attempt: 0,
      maxAttempts: 3,
      progress: '',
      error: null,
      updatedAt: 1,
      input: { requirements: [] }
    }
  }
}

function answer(over: Partial<AnswerState>): AnswerState {
  return { locked: true, sentBeforePilot: false, state: null, readyAt: null, reason: null, ...over }
}

describe('inTab', () => {
  it.each([
    ['open, no preparation', 'open', null, null, ['needs_you', 'all']],
    ['open, ready', 'open', 'ready', null, ['needs_you', 'all']],
    ['open, cancelled', 'open', 'cancelled', null, ['needs_you', 'all']],
    ['open, queued', 'open', 'queued', null, ['preparing', 'all']],
    ['open, generating', 'open', 'generating', null, ['preparing', 'all']],
    ['open, blocked', 'open', 'blocked', null, ['blocked', 'all']],
    ['answered, unlocked', 'answered', null, answer({ locked: false }), ['needs_you', 'all']],
    ['answered, locked', 'answered', null, answer({ locked: true }), ['all']],
    [
      'answered, locked but failed',
      'answered',
      null,
      answer({ locked: true, state: 'failed' }),
      ['needs_you', 'all']
    ],
    ['answered, no answer state', 'answered', null, null, ['all']],
    ['done', 'done', null, null, ['all']]
  ] as const)('%s', (_name, status, prep, ans, want) => {
    const item = card({ status, ...prepared(prep) })
    const tabs = (['needs_you', 'preparing', 'blocked', 'all'] as const).filter((t) =>
      inTab(item, t, ans)
    )
    expect(tabs).toEqual(want)
  })

  it('keeps defaults out of every tab', () => {
    const item = card({ type: 'default' })
    expect(
      (['needs_you', 'preparing', 'blocked', 'all'] as const).some((t) => inTab(item, t, null))
    ).toBe(false)
  })
})

describe('tabCounts', () => {
  it('counts 8 ready and 9 preparing cards', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => card({ id: `r${i}`, ...prepared('ready') })),
      ...Array.from({ length: 9 }, (_, i) =>
        card({ id: `p${i}`, ...prepared(i % 2 ? 'queued' : 'generating') })
      )
    ]
    expect(tabCounts(items)).toEqual({ needs_you: 8, preparing: 9, blocked: 0, all: 17 })
  })

  it('counts a cancelled open card as waiting, in step with waitingCount', () => {
    const items = [card({ ...prepared('cancelled') }), card({ id: 'b', ...prepared('blocked') })]
    expect(waitingCount(items)).toBe(1)
    expect(tabCounts(items).needs_you).toBe(1)
  })
})

describe('matchesFilters', () => {
  const none = { kinds: [], query: '' } as const
  const item = card({
    title: 'Which Carrier?',
    itemKey: 'mr:77',
    itemLabel: 'MR !77',
    context: 'about shipping'
  })

  it.each([
    ['the title, any case', 'carrier', 'x', true],
    ['the context', 'SHIPPING', 'x', true],
    ['the item label', 'mr !77', 'x', true],
    ['nothing but the internal key', 'mr:77', 'x', false],
    ['the group label', 'web-1493', 'web-1493 / ci', true],
    ['nothing', 'zzz', 'web', false]
  ])('query matches %s', (_name, query, group, want) => {
    expect(matchesFilters(item, { ...none, query }, group)).toBe(want)
  })

  it('filters by kind', () => {
    expect(matchesFilters(item, { kinds: ['bug'], query: '' }, 'g')).toBe(false)
    expect(matchesFilters(item, { kinds: ['bug', 'question'], query: '' }, 'g')).toBe(true)
    expect(matchesFilters(item, none, 'g')).toBe(true)
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
