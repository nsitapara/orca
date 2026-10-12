import { describe, expect, it } from 'vitest'
import type { InboxType } from '../api-types'
import { answerWord, routeAnswer, START_RUN_ONLY, startNotes, type Route } from './route'

type Parts = Record<string, string>
const CLEANUP: Parts = { '1': 'web-1474 !1402', '2': 'web-2077 !1499', '3': 'web-1513 !1513' }
const REVIEW: Parts = { F1: 'Null check in TreeNode', F2: 'Naming in Filters' }

function route(
  type: InboxType,
  text: string,
  runnable: boolean,
  parts: Parts = {},
  action: string | null = null
): Route {
  return routeAnswer({
    type,
    text,
    runnable,
    parts,
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
    ['action', 'approve', true, { kind: 'script', leaveOut: [] }],
    ['action', 'Do it', true, { kind: 'script', leaveOut: [] }],
    ['action', 'skip', true, { kind: 'tick', outcome: 'skipped' }],
    ['action', "don't", true, { kind: 'tick', outcome: 'skipped' }],
    ['action', 'revise: drop finding 2', true, { kind: 'agent', revise: true }],
    ['action', 'drop finding 2', true, { kind: 'agent', revise: true }],
    ['action', 'approve', false, { kind: 'agent', revise: false }],
    ['bug', 'approve', false, { kind: 'agent', revise: false }],
    ['left_for_you', 'keep the old value on Escape too', false, { kind: 'agent', revise: false }],
    ['bug', 'skip', false, { kind: 'tick', outcome: 'skipped' }]
  ])('%s answered %j (runnable %s)', (type, text, runnable, expected) => {
    expect(route(type, text, runnable)).toEqual(expected)
  })

  it.each<[string, Parts, Route]>([
    ['approve', CLEANUP, { kind: 'script', leaveOut: [] }],
    ['keep: web-1513', CLEANUP, { kind: 'script', leaveOut: ['3'] }],
    ['keep: !1499, 3', CLEANUP, { kind: 'script', leaveOut: ['2', '3'] }],
    ['keep: 1 2 3', CLEANUP, { kind: 'tick', outcome: 'skipped' }],
    ['keep: web-9999', CLEANUP, { kind: 'agent', revise: true }],
    ['keep: web', { '1': 'web a', '2': 'web b' }, { kind: 'agent', revise: true }],
    ['keep: ,', CLEANUP, { kind: 'agent', revise: true }],
    ['approve except: ,', REVIEW, { kind: 'agent', revise: true }],
    ['approve except: ;', REVIEW, { kind: 'agent', revise: true }],
    ['approve except: F2', REVIEW, { kind: 'script', leaveOut: ['F2'] }],
    [
      'approve except: x; part ñ1: soften',
      { x: 'x;', y: 'part ñ1: soften' },
      { kind: 'agent', revise: true }
    ],
    ['part F2: make this a question', REVIEW, { kind: 'agent', revise: true }],
    ['revise: leave out F1; part F2: soften it', REVIEW, { kind: 'agent', revise: true }]
  ])('parts: %j', (text, parts, expected) => {
    expect(route('action', text, true, parts)).toEqual(expected)
  })

  it.each<[string, Route]>([
    ['Approve', { kind: 'script', leaveOut: [] }],
    ['skip', { kind: 'tick', outcome: 'skipped' }],
    ['approve: use the second fix', { kind: 'script', leaveOut: [] }],
    ['start it after lunch', { kind: 'reask', reason: START_RUN_ONLY }]
  ])('an ask-first card answered %j', (text, expected) => {
    expect(route('action', text, true, {}, 'start_run')).toEqual(expected)
  })

  it.each<[number, Route]>([
    [0, { kind: 'script', leaveOut: [] }],
    [1, { kind: 'tick', outcome: 'skipped' }]
  ])(
    'an ask-first card with its own option labels, answered with option %i',
    (option, expected) => {
      expect(
        routeAnswer({
          type: 'action',
          action: 'start_run',
          runnable: true,
          parts: {},
          text: 'Review',
          option
        })
      ).toEqual(expected)
    }
  )
})

describe('startNotes', () => {
  it.each([
    ['Approve', ''],
    ['approve: Use the second fix', 'Use the second fix'],
    ['start:  keep it short ', 'keep it short'],
    ['skip', '']
  ])('%j → %j', (text, notes) => expect(startNotes(text)).toBe(notes))
})
