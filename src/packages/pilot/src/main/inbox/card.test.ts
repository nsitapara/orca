import { describe, expect, it } from 'vitest'
import { buildCard, inboxDigest, parseOption, toInboxSummary } from './card'
import type { InboxItemRow } from '../../shared/api-types'
import type { InboxAddParams } from '../../shared/inbox-types'

const PUSH: InboxAddParams = {
  type: 'action',
  title: "Push !1561's 2 commits to origin?",
  context: 'Fixed the flaky spec.',
  suggested: 'Approve',
  options: ['Approve — push them to origin; CI runs on the new head', 'Skip — keep them local'],
  action: 'push',
  actionArgs: { argv: ['/wt/1493', 'web-1493-a', '9c1e2f0', '1a2b3c4'] }
}

describe('parseOption', () => {
  it.each([
    ['Approve — push them', { label: 'Approve', meaning: 'push them' }],
    ['Skip', { label: 'Skip', meaning: '' }],
    ['  Retry   once — run  it   again ', { label: 'Retry once', meaning: 'run it again' }],
    ['   ', null]
  ])('%j', (raw, expected) => expect(parseOption(raw)).toEqual(expected))
})

describe('buildCard', () => {
  it.each([
    [{ ...PUSH, title: '  ' }, 'A card needs a title'],
    [{ ...PUSH, type: 'question' as const }, 'Only an action card can carry an action'],
    [{ ...PUSH, action: undefined }, 'Action arguments need an action'],
    [
      { ...PUSH, parts: { 'F 1': 'x' } },
      'Part id "F 1" must be letters, digits, dots, dashes or underscores'
    ],
    [{ ...PUSH, detailsMd: 'x'.repeat(64 * 1024 + 1) }, 'Details are limited to 64 KB'],
    [
      { ...PUSH, actionArgs: { argv: ['x'.repeat(16 * 1024)] } },
      'Action arguments are limited to 16 KB'
    ],
    [
      { ...PUSH, parts: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, 'x'])) },
      'A card can have at most 20 parts'
    ],
    [
      { ...PUSH, options: Array.from({ length: 11 }, () => 'x') },
      'A card can have at most 10 options'
    ]
  ])('refuses %#', (params, message) => expect(() => buildCard(params)).toThrow(message))

  it('collapses text to one line and keeps the pinned arguments', () => {
    const card = buildCard({ ...PUSH, context: 'line one\nline   two' })
    expect(card).toMatchObject({
      context: 'line one line two',
      actionArgs: PUSH.actionArgs,
      parts: {},
      switchWords: []
    })
  })
})

describe('inboxDigest', () => {
  const base = inboxDigest(buildCard(PUSH))

  it('is a stable sha256', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(inboxDigest(buildCard({ ...PUSH }))).toBe(base)
  })

  it.each([
    ['type', { type: 'bug' as const, action: undefined, actionArgs: undefined }],
    ['title', { title: 'Push 3 commits?' }],
    ['context', { context: 'Something else.' }],
    ['options', { options: ['Approve — push', 'Skip — keep them local'] }],
    ['action', { action: 'mark_ready' }],
    ['pinned args', { actionArgs: { argv: ['/wt/1493', 'web-1493-a', 'ffffff0', '1a2b3c4'] } }],
    ['parts', { parts: { F1: 'Null check' } }],
    ['switch words', { parts: { F1: 'Null check' }, switchWords: ['Post', 'Leave out'] }],
    ['details', { detailsMd: '```diff\n-a\n+b\n```' }]
  ])('changes with the %s', (_name, change) => {
    expect(inboxDigest(buildCard({ ...PUSH, ...change }))).not.toBe(base)
  })

  it('ignores the suggestion', () => {
    expect(inboxDigest(buildCard({ ...PUSH, suggested: 'Skip' }))).toBe(base)
  })
})

describe('toInboxSummary', () => {
  it('keeps only what a timeline row shows', () => {
    const row = {
      id: 'in_1',
      automationId: 'ci',
      runId: 'run-1',
      stepIdx: 0,
      itemKey: 'mr:1561',
      worktreePath: '/wt/1493',
      person: 'nish',
      ...buildCard(PUSH),
      digest: 'd',
      version: 1,
      status: 'open',
      answer: null,
      answeredAt: null,
      answeredBy: null,
      outcome: null,
      replies: [],
      createdAt: 5,
      updatedAt: 6,
      source: 'engine',
      vaultRef: null
    } satisfies InboxItemRow
    expect(toInboxSummary(row)).toEqual({
      id: 'in_1',
      automationId: 'ci',
      runId: 'run-1',
      stepIdx: 0,
      itemKey: 'mr:1561',
      worktreePath: '/wt/1493',
      person: 'nish',
      type: 'action',
      title: PUSH.title,
      context: 'Fixed the flaky spec.',
      status: 'open',
      createdAt: 5
    })
  })
})
