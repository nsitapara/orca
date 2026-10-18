import { describe, expect, it } from 'vitest'
import type { InboxType } from '../api-types'
import { answerWord, routeAnswer, START_RUN_ONLY, startNotes, startsRun, type Route } from './route'

function route(
  type: InboxType,
  text: string,
  runnable: boolean,
  action: string | null = null
): Route {
  return routeAnswer({
    type,
    text,
    runnable,
    action: action ?? (runnable ? 'remove-worktree' : null)
  })
}

describe('answerWord', () => {
  it.each([
    ['  Do   it!. ', 'do it'],
    ['OK.', 'ok'],
    ['', '']
  ])('%j → %j', (text, word) => expect(answerWord(text)).toBe(word))
})

describe('routeAnswer (test_apply.py test_route)', () => {
  it.each<[InboxType, string, boolean, Route]>([
    ['question', 'Keep it', false, { kind: 'agent', revise: false }],
    ['question', 'no', false, { kind: 'agent', revise: false }],
    ['default', 'keep', false, { kind: 'tick', outcome: 'kept' }],
    ['flagged', 'OK.', false, { kind: 'tick', outcome: 'kept' }],
    ['flagged', 'revert it', false, { kind: 'agent', revise: false }],
    ['action', 'approve', true, { kind: 'script' }],
    ['action', 'Do it', true, { kind: 'script' }],
    ['action', 'skip', true, { kind: 'tick', outcome: 'skipped' }],
    ['action', "don't", true, { kind: 'tick', outcome: 'skipped' }],
    ['action', 'revise: drop finding 2', true, { kind: 'agent', revise: true }],
    ['action', 'drop finding 2', true, { kind: 'agent', revise: true }],
    ['action', 'approve except: F2', true, { kind: 'agent', revise: true }],
    ['action', 'approve', false, { kind: 'agent', revise: false }],
    ['bug', 'approve', false, { kind: 'agent', revise: false }],
    ['left_for_you', 'keep the old value on Escape too', false, { kind: 'agent', revise: false }],
    ['bug', 'skip', false, { kind: 'tick', outcome: 'skipped' }]
  ])('%s answered %j (runnable %s)', (type, text, runnable, expected) => {
    expect(route(type, text, runnable)).toEqual(expected)
  })

  it.each<[string, Route]>([
    ['Approve', { kind: 'script' }],
    ['skip', { kind: 'tick', outcome: 'skipped' }],
    ['approve: use the second fix', { kind: 'script' }],
    ['start it after lunch', { kind: 'reask', reason: START_RUN_ONLY }]
  ])('an ask-first card answered %j', (text, expected) => {
    expect(route('action', text, true, 'start_run')).toEqual(expected)
  })

  it.each<[number, Route]>([
    [0, { kind: 'script' }],
    [1, { kind: 'tick', outcome: 'skipped' }]
  ])(
    'an ask-first card whose labels it was not given, answered with option %i',
    (option, expected) => {
      expect(
        routeAnswer({
          type: 'action',
          action: 'start_run',
          runnable: true,
          text: 'Review',
          option
        })
      ).toEqual(expected)
    }
  )

  const START: Route = { kind: 'script' }
  const SKIPPED: Route = { kind: 'tick', outcome: 'skipped' }
  it.each<[string, number | null, string, Route]>([
    ['the first start option', 0, 'Backend', START],
    ['another start option', 1, 'Full stack + UI', START],
    ['another start option, with notes', 1, 'approve: check the migration', START],
    ['the Skip option', 2, 'Skip', SKIPPED],
    ['an option past the labels', 3, 'x', SKIPPED],
    ['words, no option', null, 'approve', START]
  ])('a card with more than one start option, answered with %s', (_, option, text, expected) => {
    expect(
      routeAnswer({
        type: 'action',
        action: 'start_run',
        runnable: true,
        text,
        option,
        options: ['Backend', 'Full stack + UI', 'Skip']
      })
    ).toEqual(expected)
  })

  it('a two-option card with its labels routes as before: Approve starts, Skip skips', () => {
    const labels = ['Approve', 'Skip']
    const answer = { type: 'action' as const, action: 'start_run', runnable: true }
    expect(routeAnswer({ ...answer, text: 'Approve', option: 0, options: labels })).toEqual(START)
    expect(routeAnswer({ ...answer, text: 'Skip', option: 1, options: labels })).toEqual(SKIPPED)
  })
})

describe('startsRun', () => {
  it.each<[number, readonly string[] | undefined, boolean]>([
    [0, undefined, true],
    [1, undefined, false],
    [1, ['Backend', 'Full stack + UI', 'Skip'], true],
    [2, ['Backend', 'Full stack + UI', 'Skip'], false],
    [1, ['Approve', 'No'], false],
    [5, ['Approve'], false]
  ])('option %i of %j → %s', (option, labels, starts) => {
    expect(startsRun(option, labels)).toBe(starts)
  })
})

describe('startNotes', () => {
  it.each([
    ['Approve', ''],
    ['approve: Use the second fix', 'Use the second fix'],
    ['start:  keep it short ', 'keep it short'],
    ['skip', '']
  ])('%j → %j', (text, notes) => expect(startNotes(text)).toBe(notes))
})
