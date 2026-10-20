import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import type { PreparationRef } from '../../../shared/preparation'
import { waitingCount } from './answer-text'
import {
  emptyTabText,
  INBOX_KINDS,
  inTab,
  kindCounts,
  matchesFilters,
  preparingNote,
  tabCounts
} from './inbox-tabs'

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
    [
      'answered, sent before Pilot (never locks)',
      'answered',
      null,
      answer({ locked: false, sentBeforePilot: true }),
      ['all']
    ],
    [
      'answered, sent before Pilot and failed',
      'answered',
      null,
      answer({ locked: false, sentBeforePilot: true, state: 'failed' }),
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
  it('filters by kind', () => {
    const item = card({ title: 'Which Carrier?' })
    expect(matchesFilters(item, { kinds: ['bug'] })).toBe(false)
    expect(matchesFilters(item, { kinds: ['bug', 'question'] })).toBe(true)
    expect(matchesFilters(item, { kinds: [] })).toBe(true)
  })
})

describe('emptyTabText', () => {
  it.each([
    ['a picked kind on a card tab', 'needs_you', true, 'No cards match these filters.'],
    ['Done for you, whatever is picked', 'done', true, 'Nothing done for Nish here.']
  ] as const)('names %s', (_case, tab, filtered, want) => {
    expect(emptyTabText(tab, filtered, 'Nish')).toBe(want)
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

describe('preparingNote', () => {
  const queued = (id: string) => card({ id, ...prepared('queued') })
  const items = [queued('a'), queued('b'), card({ id: 'c' })]

  it.each([
    ['one of two queued cards has a wait', new Set(['a', 'c']), '1 waiting'],
    ['none has a wait (older host)', new Set<string>(), null]
  ])('when %s', (_name, waiting, want) => {
    expect(preparingNote(items, (item) => waiting.has(item.id))).toBe(want)
  })
})
