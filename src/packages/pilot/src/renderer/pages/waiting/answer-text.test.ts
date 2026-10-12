import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import { startNotes } from '../../../shared/answers/route'
import { choicesFor, composeAnswer, queueNote, waitingCount, worktreeName } from './answer-text'

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
    action: null,
    actionArgs: null,
    parts: {},
    switchWords: [],
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
      const answer = composeAnswer(ASK, choice, notes, [])
      expect(answer).toEqual({ option: null, text })
      expect(startNotes(answer!.text)).toBe(notes.trim())
    }
  )

  const pick = (item: InboxItemRow, label: string) =>
    choicesFor(item).find((c) => c.label === label)!
  const POST = { ...PUSH, action: 'post_review', parts: { F1: 'Null check', F2: 'Naming' } }

  it.each<[string, InboxItemRow, string, string, string[], unknown]>([
    ['Approve', PUSH, 'Approve', '', [], { option: 0, text: 'approve' }],
    ['Skip', PUSH, 'Skip', '', [], { option: 1, text: 'skip' }],
    [
      'Revise with notes',
      PUSH,
      'Revise…',
      ' push only the fix ',
      [],
      { option: null, text: 'revise: push only the fix' }
    ],
    ['Revise without notes', PUSH, 'Revise…', '  ', [], null],
    [
      'a question option',
      card({ options: [{ label: 'e2e', meaning: '' }] }),
      'e2e',
      '',
      [],
      { option: 0, text: 'e2e' }
    ],
    [
      'a "…" option',
      card({ type: 'default', options: [{ label: 'Change…', meaning: '' }] }),
      'Change…',
      'use PDF ids',
      [],
      { option: 0, text: 'change: use PDF ids' }
    ],
    [
      'some parts left out',
      POST,
      'Approve',
      '',
      ['F2'],
      { option: null, text: 'approve except: F2' }
    ],
    [
      'parts kept with a Keep switch',
      { ...POST, switchWords: ['Delete', 'Keep'] },
      'Approve',
      '',
      ['F1'],
      { option: null, text: 'keep: F1' }
    ],
    ['every part left out', POST, 'Approve', '', ['F1', 'F2'], { option: null, text: 'skip' }]
  ])('%s', (_name, item, label, notes, off, expected) => {
    expect(composeAnswer(item, pick(item, label), notes, off)).toEqual(expected)
  })
})

describe('queue and rail words', () => {
  it.each([
    [
      { state: 'held', holdReason: 'typing', holdDetail: 'someone is typing in zsh', readyAt: 0 },
      'someone is typing in zsh'
    ],
    [{ state: 'not_ready', holdReason: null, holdDetail: null, readyAt: 5 }, 'Settles at 10:42'],
    [
      { state: 'ready', holdReason: null, holdDetail: null, readyAt: 0 },
      'Next answer check, under a minute'
    ]
  ])('%j', (entry, note) => expect(queueNote(entry as never, () => '10:42')).toBe(note))

  it('names a worktree by its folder, and counts only open non-default cards', () => {
    expect([worktreeName('/wt/web-1493'), worktreeName(null)]).toEqual(['web-1493', 'Job-wide'])
    expect(waitingCount([card({}), card({ type: 'default' }), card({ status: 'answered' })])).toBe(
      1
    )
  })
})
