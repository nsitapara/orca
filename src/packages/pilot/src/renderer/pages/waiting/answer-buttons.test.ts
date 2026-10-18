import { describe, expect, it } from 'vitest'
import type { InboxItemRow, InboxListRow } from '../../../shared/api-types'
import { queuedPreparation } from '../../../shared/preparation'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { composeAnswer, countdown } from './answer-text'
import { answeredLine, buttonsFor, quickAnswerFor } from './answer-buttons'

const base = {
  options: [],
  details: null,
  action: null
} as unknown as InboxItemRow
const opts = (...l: string[]) => l.map((label) => ({ label, meaning: `${label} m` }))
const CARDS: Record<string, InboxItemRow> = {
  push: { ...base, type: 'action', action: 'push', options: opts('Approve', 'Skip') },
  markReady: { ...base, type: 'action', action: 'mark_ready', options: opts('Approve', 'Skip') },
  startRun: { ...base, type: 'action', action: 'start_run', options: opts('Approve', 'Skip') },
  multiStart: {
    ...base,
    type: 'action',
    action: 'start_run',
    options: opts('Backend', 'Full stack + UI', 'Skip')
  },
  leftNoDraft: { ...base, type: 'left_for_you', options: opts('Approve', 'Skip') },
  bugDrafted: {
    ...base,
    type: 'bug',
    options: opts('Approve', 'Skip'),
    details: { drafted: true } as never
  },
  question: {
    ...base,
    type: 'question',
    options: opts('Install in the job', 'Bake it', 'Change…')
  },
  flagged: { ...base, type: 'flagged', options: opts('Revert') },
  default: { ...base, type: 'default', options: opts('Keep', 'Revert') }
}

// Every button, with the answer the old radio + Save flow saved for the same choice (notes "some notes"):
// [button label, role, option index, words]. The words and indexes are what routing, the desktop-only
// approval and the draft grant read, so they must never drift.
const OLD: Record<string, [string, string, number | null, string][]> = {
  push: [
    ['Push to origin', 'primary', 0, 'approve'],
    ['Revise…', 'notes', null, 'revise: some notes'],
    ['Skip', 'skip', 1, 'skip']
  ],
  markReady: [
    ['Mark ready', 'primary', 0, 'approve'],
    ['Revise…', 'notes', null, 'revise: some notes'],
    ['Skip', 'skip', 1, 'skip']
  ],
  startRun: [
    ['Approve', 'primary', 0, 'Approve'],
    ['With notes…', 'notes', null, 'approve: some notes'],
    ['Skip', 'skip', 1, 'Skip']
  ],
  // Not an old radio card: each start option takes optional notes and keeps its index.
  multiStart: [
    ['Backend', 'notes', 0, 'approve: some notes'],
    ['Full stack + UI', 'notes', 1, 'approve: some notes'],
    ['Skip', 'skip', 2, 'Skip']
  ],
  leftNoDraft: [
    ['Fix it', 'primary', 0, 'approve'],
    ['With notes…', 'notes', null, 'some notes'],
    ['Skip', 'skip', 1, 'skip']
  ],
  bugDrafted: [
    ['Apply fix', 'primary', 0, 'approve'],
    ['With notes…', 'notes', null, 'some notes'],
    ['Skip', 'skip', 1, 'skip']
  ],
  question: [
    ['Install in the job', 'option', 0, 'Install in the job'],
    ['Bake it', 'option', 1, 'Bake it'],
    ['Change…', 'notes', 2, 'change: some notes'],
    ['Something else…', 'notes', null, 'some notes']
  ],
  flagged: [
    ['Revert', 'option', 0, 'Revert'],
    ['Keep', 'option', null, 'keep'],
    ['Something else…', 'notes', null, 'some notes']
  ],
  default: [
    ['Keep', 'option', 0, 'Keep'],
    ['Revert', 'option', 1, 'Revert'],
    ['Something else…', 'notes', null, 'some notes']
  ]
}

describe('buttonsFor', () => {
  it.each(Object.keys(OLD))('%s: each button saves what the old radio + Save saved', (name) => {
    const item = CARDS[name]
    const got = buttonsFor(item).map((b) => [
      b.label,
      b.role,
      composeAnswer(b.choice, 'some notes')
    ])
    expect(got).toEqual(
      OLD[name].map(([label, role, option, text]) => [label, role, { option, text }])
    )
  })

  it('shows an option’s meaning as its hint, and highlights a question’s first option', () => {
    const buttons = buttonsFor(CARDS.question)
    expect(buttons[0]).toMatchObject({ hint: 'Install in the job m', recommended: true })
    expect(buttons[1]).toMatchObject({ recommended: false })
    expect(buttonsFor(CARDS.default).some((b) => b.recommended)).toBe(false)
  })

  it("highlights a multi-start card's first start option, and nothing on a single-start card", () => {
    expect(buttonsFor(CARDS.multiStart).map((b) => b.recommended)).toEqual([true, false, false])
    expect(buttonsFor(CARDS.startRun).some((b) => b.recommended)).toBe(false)
  })

  it('has no Save button among them', () => {
    for (const item of Object.values(CARDS)) {
      expect(buttonsFor(item).map((b) => b.label)).not.toContain('Save answer')
    }
  })
})

describe('quickAnswerFor', () => {
  const PUSH = inboxRow({ type: 'action', action: 'push', options: opts('Approve', 'Skip') })
  it.each<[string, InboxListRow, ReturnType<typeof quickAnswerFor>]>([
    [
      'a ready push: its Approve',
      PUSH,
      { label: 'Push to origin', answer: { option: 0, text: 'approve' } }
    ],
    [
      'a question: its first option',
      inboxRow({ options: opts('Install in the job', 'Bake it') }),
      { label: 'Install in the job', answer: { option: 0, text: 'Install in the job' } }
    ],
    ['a card that needs evidence', { ...PUSH, needsEvidence: true }, null],
    [
      'a card still preparing',
      { ...PUSH, preparation: queuedPreparation({ key: 'k', context: 'c', requirements: [] }, 1) },
      null
    ],
    [
      'a card whose first choice opens notes',
      inboxRow({
        type: 'action',
        action: 'start_run',
        options: opts('Backend', 'Full stack', 'Skip')
      }),
      null
    ],
    ['an answered card', { ...PUSH, status: 'answered' }, null]
  ])('%s', (_name, item, want) => {
    expect(quickAnswerFor(item)).toEqual(want)
  })
})

describe('answeredLine', () => {
  const answered = (item: InboxItemRow, text: string) =>
    ({ ...item, answer: { text } }) as unknown as InboxItemRow
  it.each([
    ['markReady', 'approve', 'Mark ready', 'Marking ready…'],
    ['bugDrafted', 'approve', 'Apply fix', 'Applying fix…'],
    ['leftNoDraft', 'approve', 'Fix it', 'Starting the fix…'],
    ['markReady', 'skip', 'Skipped', 'Skipped'],
    ['startRun', 'Skip', 'Skipped', 'Skipped'],
    ['question', 'Bake it', 'Bake it', 'Applying…']
  ])('%s answered "%s"', (name, text, what, doing) => {
    expect(answeredLine(answered(CARDS[name], text))).toEqual({ label: what, doing })
  })
})

describe('countdown', () => {
  it.each([
    [179_000, '2:59'],
    [60_000, '1:00'],
    [5_400, '0:06'],
    [0, '0:00'],
    [-4_000, '0:00']
  ])('%i ms is %s', (ms, text) => {
    expect(countdown(ms)).toBe(text)
  })
})

// R-P5: a card that needs evidence offers no button that would run it; Prepare evidence sits above the answers.
describe('a card that needs evidence', () => {
  it.each(['push', 'bugDrafted'])('offers only an answer with notes and Skip: %s', (name) => {
    const buttons = buttonsFor({ ...CARDS[name], needsEvidence: true } as never)
    expect(buttons.map((b) => b.role)).toEqual(['notes', 'skip'])
    expect(buttons.some((b) => /approve|push/i.test(b.label))).toBe(false)
  })

  // Nothing is preparing until Prepare evidence queues it, so its words never talk of context on its way.
  it.each([
    ['never prepared', { needsEvidence: true }, 'Answer without evidence…', /prepar(ation|ing)/i],
    ['preparing', { preparation: { state: 'queued' } }, 'Answer before context is ready…', null]
  ])('a %s card names its early answer for what it does', (_, over, label, absent) => {
    const buttons = buttonsFor({ ...CARDS.bugDrafted, ...over } as never)
    expect(buttons[0].label).toBe(label)
    if (absent) {
      const words = buttons.flatMap((b) => [b.label, b.hint, b.choice.meaning])
      expect(words.filter((w) => absent.test(w))).toEqual([])
    }
  })
})
