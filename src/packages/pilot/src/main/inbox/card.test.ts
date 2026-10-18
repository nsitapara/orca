import { describe, expect, it } from 'vitest'
import { buildCard, cardOf, inboxDigest, parseOption, toInboxSummary } from './card'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsRef } from '../../shared/details'
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
    [{ ...PUSH, detailsMd: 'x'.repeat(64 * 1024 + 1) }, 'Details are limited to 64 KB'],
    [
      { ...PUSH, detailsMd: '## Why', detailsBundlePath: '/v/F2.json' },
      'Give Details as markdown (--details-file) or as a bundle (--details-bundle), not both'
    ],
    [
      { ...PUSH, actionArgs: { argv: ['x'.repeat(16 * 1024)] } },
      'Action arguments are limited to 16 KB'
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
      actionArgs: PUSH.actionArgs
    })
  })
})

const F2: DetailsRef = {
  path: '/v/A/job/details/r/F2.json',
  sha256: 'a'.repeat(64),
  inlined: {},
  blocks: 8,
  drafted: true,
  draftedBase: '7cc153d0000000000000000000000000000000000'
}

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
    ['details', { detailsMd: '```diff\n-a\n+b\n```' }]
  ])('changes with the %s', (_name, change) => {
    expect(inboxDigest(buildCard({ ...PUSH, ...change }))).not.toBe(base)
  })

  it('ignores the suggestion', () => {
    expect(inboxDigest(buildCard({ ...PUSH, suggested: 'Skip' }))).toBe(base)
  })

  // Pinned from the code before bundles: a card without one must keep its exact digest.
  it.each([
    ['a plain card', PUSH, '6ae9b6066ee89adc970fa8ed14f7926f918923f14c76564b025f2dc14eb4db18'],
    [
      'a card with markdown Details',
      { ...PUSH, detailsMd: '```diff\n-a\n+b\n```' },
      '6dedf99646862f1ca0694721a6f7a94b935b343164c23646940469f08e27f316'
    ]
  ])('keeps %s at its digest from before bundles', (_name, params, digest) => {
    expect(inboxDigest(buildCard(params))).toBe(digest)
  })

  it("binds to the bundle's path, its bytes and each inlined review text", () => {
    const bundled = inboxDigest(buildCard(PUSH, F2))
    expect(bundled).not.toBe(base)
    expect(inboxDigest(buildCard(PUSH, { ...F2 }))).toBe(bundled)
    expect(inboxDigest(buildCard(PUSH, { ...F2, path: '/v/A/job/details/s/F2.json' }))).not.toBe(
      bundled
    )
    expect(inboxDigest(buildCard(PUSH, { ...F2, sha256: 'b'.repeat(64) }))).not.toBe(bundled)
    const reviewed = { ...F2, inlined: { 'r.json': 'c'.repeat(64) } }
    expect(inboxDigest(buildCard(PUSH, reviewed))).not.toBe(bundled)
    expect(inboxDigest(buildCard(PUSH, { ...F2, inlined: { 'r.json': 'd'.repeat(64) } }))).not.toBe(
      inboxDigest(buildCard(PUSH, reviewed))
    )
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
      details: null,
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
    expect(cardOf({ ...row, details: F2 }).details).toEqual(F2)
  })
})
