import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { InboxPreparation } from '../../../shared/preparation'
import { startNotes } from '../../../shared/answers/route'
import {
  ageLabel,
  applyReport,
  askedLabel,
  choicesFor,
  composeAnswer,
  heldTooLong,
  jobCode,
  queueNote,
  queueSummary,
  waitingCount,
  worktreeName
} from './answer-text'

function card(over: Partial<InboxItemRow>): InboxItemRow {
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
const PUSH = card({
  type: 'action',
  action: 'push',
  actionArgs: { argv: ['a'] },
  options: [
    { label: 'Approve', meaning: 'push them to origin' },
    { label: 'Skip', meaning: 'keep them local' }
  ]
})
const labels = (item: InboxItemRow) => choicesFor(item).map((c) => c.label)

const MULTI = card({
  type: 'action',
  action: 'start_run',
  actionArgs: { run_id: 'r' },
  options: [
    { label: 'Backend', meaning: 'a backend stack' },
    { label: 'Full stack + UI', meaning: 'the frontends too' },
    { label: 'Skip', meaning: 'not this head' }
  ]
})

describe('choicesFor', () => {
  it.each([
    ['an action with an action to run', PUSH, ['Approve', 'Revise…', 'Skip']],
    [
      'a bug with nothing to run',
      card({ type: 'bug' }),
      ['Approve', 'Approve with notes…', 'Skip']
    ],
    [
      'an ask-first card',
      card({ type: 'action', action: 'start_run', actionArgs: { run_id: 'r' } }),
      ['Approve', 'Approve with notes…', 'Skip']
    ],
    [
      'an ask-first card with its own options',
      card({
        type: 'action',
        action: 'start_run',
        actionArgs: { run_id: 'r' },
        options: [
          { label: 'Review', meaning: 'run the review now' },
          { label: 'Skip', meaning: 'not today' }
        ]
      }),
      ['Review', 'Approve with notes…', 'Skip']
    ],
    ['an ask-first card with two start options', MULTI, ['Backend', 'Full stack + UI', 'Skip']],
    [
      'a question',
      card({
        options: [
          { label: 'e2e', meaning: '' },
          { label: 'unit', meaning: '' }
        ]
      }),
      ['e2e', 'unit', 'Something else…']
    ],
    [
      'a default the agent took',
      card({ type: 'default', options: [{ label: 'Change…', meaning: '' }] }),
      ['Change…', 'Keep', 'Something else…']
    ]
  ])('%s', (_name, item, expected) => expect(labels(item)).toEqual(expected))

  it("carries the card's own words for Approve and Skip", () => {
    expect(choicesFor(PUSH).map((c) => c.meaning)).toEqual([
      'push them to origin',
      'change it and ask again; nothing runs',
      'keep them local'
    ])
  })
})

describe('composeAnswer', () => {
  const ASK = card({
    type: 'action',
    action: 'start_run',
    actionArgs: { run_id: 'r' },
    options: [
      { label: 'Approve', meaning: 'start it now' },
      { label: 'Skip', meaning: 'nothing starts' }
    ]
  })
  it.each([
    ['notes', ' use the second fix ', 'approve: use the second fix'],
    ['no notes', '  ', 'approve']
  ])(
    'an ask-first Approve with %s starts the run, and the notes are its {run.answer}',
    (_n, notes, text) => {
      const choice = choicesFor(ASK).find((c) => c.label === 'Approve with notes…')!
      const answer = composeAnswer(choice, notes)
      expect(answer).toEqual({ option: null, text })
      expect(startNotes(answer!.text)).toBe(notes.trim())
    }
  )

  it.each<[string, string, unknown]>([
    ['Backend', '', { option: 0, text: 'Backend' }],
    ['Full stack + UI', '', { option: 1, text: 'Full stack + UI' }],
    [
      'Full stack + UI',
      ' check the migration ',
      { option: 1, text: 'approve: check the migration' }
    ]
  ])(
    'a multi-start card: %s with notes %j keeps its option, and the notes are its {run.answer}',
    (label, notes, expected) => {
      const choice = choicesFor(MULTI).find((c) => c.label === label)!
      expect(choice.notes).toBe('optional')
      expect(composeAnswer(choice, notes)).toEqual(expected)
    }
  )

  it("a multi-start card's Skip takes no notes", () => {
    const skip = choicesFor(MULTI).find((c) => c.label === 'Skip')!
    expect([skip.notes, composeAnswer(skip, '')]).toEqual(['none', { option: 2, text: 'Skip' }])
  })

  const pick = (item: InboxItemRow, label: string) =>
    choicesFor(item).find((c) => c.label === label)!

  it.each<[string, InboxItemRow, string, string, unknown]>([
    ['Approve', PUSH, 'Approve', '', { option: 0, text: 'approve' }],
    ['Skip', PUSH, 'Skip', '', { option: 1, text: 'skip' }],
    [
      'Revise with notes',
      PUSH,
      'Revise…',
      ' push only the fix ',
      { option: null, text: 'revise: push only the fix' }
    ],
    ['Revise without notes', PUSH, 'Revise…', '  ', null],
    [
      'a question option',
      card({ options: [{ label: 'e2e', meaning: '' }] }),
      'e2e',
      '',
      { option: 0, text: 'e2e' }
    ],
    [
      'a "…" option',
      card({ type: 'default', options: [{ label: 'Change…', meaning: '' }] }),
      'Change…',
      'use PDF ids',
      { option: 0, text: 'change: use PDF ids' }
    ]
  ])('%s', (_name, item, label, notes, expected) => {
    expect(composeAnswer(pick(item, label), notes)).toEqual(expected)
  })
})

describe('queue and rail words', () => {
  it.each([
    [
      { state: 'held', holdReason: 'typing', holdDetail: 'someone is typing in zsh', readyAt: 0 },
      'someone is typing in zsh'
    ],
    [{ state: 'not_ready', holdReason: null, holdDetail: null, readyAt: 161_000 }, 'Goes in 2:41'],
    [
      { state: 'not_ready', holdReason: null, holdDetail: null, readyAt: 0 },
      'Next answer check, under a minute'
    ],
    [
      { state: 'ready', holdReason: null, holdDetail: null, readyAt: 0 },
      'Next answer check, under a minute'
    ]
  ])('%j', (entry, note) => expect(queueNote(entry as never, 0)).toBe(note))

  const MIN = 60_000
  it.each([
    ['held 20 minutes', { state: 'held', holdReason: 'typing', readyAt: -20 * MIN }, true],
    ['held 19 minutes', { state: 'held', holdReason: 'typing', readyAt: -19 * MIN }, false],
    [
      'a not-yet hold, however old',
      { state: 'held', holdReason: 'waits', readyAt: -60 * MIN },
      false
    ],
    ['settling', { state: 'not_ready', holdReason: null, readyAt: -60 * MIN }, false]
  ])('%s: held too long is %s', (_name, entry, want) => {
    expect(heldTooLong(entry as never, 0)).toBe(want)
  })

  it.each([
    [
      'held, due and settling',
      [
        { state: 'held', readyAt: -MIN },
        { state: 'held', readyAt: -MIN },
        { state: 'ready', readyAt: -MIN },
        { state: 'not_ready', readyAt: 161_000 }
      ],
      '4 from your answers (2 held · 1 at the next check · 1 in 2:41)'
    ],
    [
      'several settling, from the first',
      [
        { state: 'not_ready', readyAt: 3 * MIN },
        { state: 'not_ready', readyAt: 61_000 }
      ],
      '2 from your answers (2 from 1:01)'
    ]
  ])('sums up %s', (_name, entries, want) => {
    expect(queueSummary(entries as never, 0)).toBe(want)
  })

  it.each([
    [{ ticked: 3, held: 2 }, '3 closed · 2 still held'],
    [
      { actions: 1, agents: 1, reasked: 1, retired: 1 },
      '1 ran an action · 1 sent to an agent · 1 asked again · 1 retired with the MR'
    ],
    [{}, 'Nothing was due']
  ])('says what Apply now did: %j', (counts, want) => {
    const report = { retired: 0, ticked: 0, actions: 0, agents: 0, held: 0, reasked: 0, ...counts }
    expect(applyReport(report)).toBe(want)
  })

  it('names a worktree by its folder, and counts only open non-default cards', () => {
    expect([worktreeName('/wt/web-1493'), worktreeName(null)]).toEqual(['web-1493', 'Job-wide'])
    expect(waitingCount([card({}), card({ type: 'default' }), card({ status: 'answered' })])).toBe(
      1
    )
  })

  it('counts a cancelled preparation as waiting, since the card can still be answered', () => {
    const preparation: InboxPreparation = {
      state: 'cancelled',
      revision: 1,
      attempt: 0,
      maxAttempts: 3,
      progress: '',
      error: null,
      updatedAt: 1,
      runId: null,
      stepIdx: null,
      leaseUntil: null,
      input: { key: 'k', context: '', requirements: [] }
    }
    expect(waitingCount([card({ preparation })])).toBe(1)
  })
})

describe('ageLabel and jobCode', () => {
  const NOW = new Date(2026, 9, 12, 12, 0).getTime()
  it.each([
    [NOW - 5 * 60_000, '5m'],
    [NOW - 3 * 3_600_000, '3h'],
    [NOW - 26 * 3_600_000, '1d'],
    [NOW + 60_000, '0m'],
    [NOW - 7 * 86_400_000, '7d'],
    [new Date(2026, 8, 20, 2, 0).getTime(), 'Sep 20']
  ])('ages %i as %s', (at, want) => {
    expect(ageLabel(at, NOW)).toBe(want)
  })
  it.each([
    ['04 · Test branch UIs overnight', 'x', '04'],
    ['Docker prune', 'docker-prune', 'docker-prune']
  ])('codes %s as %s', (name, id, want) => {
    expect(jobCode(name, id)).toBe(want)
  })
})

describe('askedLabel', () => {
  const NOW = new Date(2026, 9, 12, 12, 0).getTime()
  it.each([
    [new Date(2026, 9, 11, 2, 0).getTime(), 'Asked Oct 11, 2:00 AM · 1d ago'],
    [new Date(2026, 9, 12, 9, 30).getTime(), 'Asked Oct 12, 9:30 AM · 2h ago'],
    [new Date(2026, 9, 12, 11, 55).getTime(), 'Asked Oct 12, 11:55 AM · 5m ago'],
    [new Date(2026, 8, 20, 14, 5).getTime(), 'Asked Sep 20, 2:05 PM'],
    [new Date(2025, 11, 31, 14, 5).getTime(), 'Asked Dec 31, 2025, 2:05 PM']
  ])('reads %i as "%s"', (at, want) => {
    expect(askedLabel(at, NOW).text).toBe(want)
  })
  it('keeps the full timestamp for the tooltip', () => {
    expect(askedLabel(new Date(2026, 9, 11, 2, 0).getTime(), NOW).full).toContain('2026')
  })
})
